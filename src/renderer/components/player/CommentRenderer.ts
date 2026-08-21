import NiconiComments from '@xpadev-net/niconicomments';
import type { FormattedComment } from '@xpadev-net/niconicomments';
import {
  type NNDDREComment,
  type NgListItem,
  NgListItemType
} from '@shared/types';
import { COMMENT_FONT_FAMILY } from '@shared/constants';

/**
 * ニコニココメント描画エンジン。
 * @xpadev-net/niconicomments ライブラリをラップする。
 *
 * 元の CommentRenderer (自前Canvas実装) を置き換え、
 * 公式プレイヤー互換の高精度なコメント描画を実現する。
 */

export interface CommentRenderConfig {
  /** コメントを表示するか */
  enabled: boolean;
  /** 不透明度 0..1 */
  opacity: number;
  /** フォントファミリー (ライブラリ側で管理するため参照のみ) */
  fontFamily: string;
  /** アンチエイリアス */
  antiAlias: boolean;
  /** ボールド表示 */
  bold: boolean;
  /** ドロップシャドウ (文字縁取り) */
  dropShadow: boolean;
  /**
   * 文字縁の濃さ。
   *   - 'light': 薄い (contextStrokeOpacity=0.2)
   *   - 'normal': 標準 (contextStrokeOpacity=0.4)
   */
  outlineIntensity: 'light' | 'normal';
  /** ベースのMEDIUMフォントサイズ */
  baseFontSize: number;
  /** 全コメントのサイズ倍率 */
  sizeScale: number;
  /** 流れる時間 (秒) — ライブラリ側で管理するため参照のみ */
  showSecNaka: number;
  /** 固定時間 (秒) */
  showSecFixed: number;
  /**
   * コメントアート (CA) 保護モード。
   * true にすると同時刻 CA コメントを専用レイヤーに分離し
   * 通常コメントとの衝突を防ぐ (niconicomments keepCA オプション)。
   */
  keepCA: boolean;
  /** NGリスト */
  ngList: NgListItem[];
  /**
   * NGフィルタの強度。
   *   - 'weak':   NGワードは完全一致のみ適用 (誤爆を避けたい場合)
   *   - 'medium': 部分一致も適用 (デフォルト)
   *   - 'strong': 上記に加え、短時間の連投コメントも自動非表示
   */
  ngStrength: 'weak' | 'medium' | 'strong';
}

export const DEFAULT_RENDER_CONFIG: CommentRenderConfig = {
  enabled: true,
  opacity: 1,
  fontFamily: COMMENT_FONT_FAMILY,
  antiAlias: true,
  bold: false,
  dropShadow: true,
  outlineIntensity: 'light',
  baseFontSize: 36,
  sizeScale: 1,
  showSecNaka: 3,
  showSecFixed: 3,
  keepCA: true,
  ngList: [],
  ngStrength: 'medium'
};

export class CommentRenderer {
  /**
   * アスペクト比維持のための基準仮想高さ (ライブラリ標準相当)。
   * コメントアート (CA) はこのグローバルスケールに乗じてテキスト幅に応じた
   * 追加補正がかかる仕組みのため、フォントサイズを画面比率と切り離して
   * 絶対固定にすると CA が画面からはみ出す。そのため常にウィンドウサイズに
   * 比例させ、アスペクト比の歪み (縦横不均一なスケール) だけを解消する。
   */
  private static readonly NORMAL_VIRTUAL_HEIGHT = 1080;

  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement | null = null;
  private nc: NiconiComments | null = null;
  private comments: NNDDREComment[] = [];
  private config: CommentRenderConfig = { ...DEFAULT_RENDER_CONFIG };
  private rafId: number | null = null;
  private lastVpos = -1;
  private lastW = 0;
  private lastH = 0;
  private rebuildSeq = 0;

  /**
   * @param container コメント canvas を配置するコンテナ要素。
   *   CommentRenderer が内部で `<canvas>` を生成・差し替えして管理する。
   *   React 側は canvas を直接 ref せず、この div のみを描画する。
   */
  constructor(container: HTMLElement) {
    this.container = container;
    // StrictMode の再マウント等で前回の canvas が残っていれば除去する
    container.querySelectorAll('canvas').forEach((c) => c.remove());
    this.canvas = this.newCanvasElement();
    container.appendChild(this.canvas);
  }

  /** コンテナ内に配置する新しい canvas 要素を生成する (DOM 追加はしない) */
  private newCanvasElement(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = 'absolute inset-0 w-full h-full';
    c.style.opacity = String(this.config.opacity);
    return c;
  }

  /**
   * 現在の canvas を新しい canvas に差し替える。
   *
   * NiconiComments (WebGL2Renderer) の destroy() は
   * `WEBGL_lose_context.loseContext()` で GL コンテキストを明示的にロストさせる。
   * ロストしたコンテキストは restoreContext() を呼ぶまで自動復元されず、
   * 同じ canvas で getContext('webgl2') を呼んでもロスト済みの古いコンテキストが
   * 返るため、続くシェーダーコンパイルが `Shader compile: null` で失敗する。
   * そこで destroy() 済み canvas は二度と再利用せず、常に真新しい canvas を
   * NiconiComments に渡すことで WebGL2 を確実に初期化させる。
   */
  private swapToFreshCanvas(): void {
    const fresh = this.newCanvasElement();
    fresh.width = this.lastW > 0 ? this.lastW : this.canvas.width;
    fresh.height = this.lastH > 0 ? this.lastH : this.canvas.height;
    this.container.appendChild(fresh);
    this.canvas.remove();
    this.canvas = fresh;
  }

  setConfig(cfg: Partial<CommentRenderConfig>): void {
    const prev = this.config;
    this.config = { ...this.config, ...cfg };

    // opacity は canvas の CSS スタイルで適用
    this.canvas.style.opacity = String(this.config.opacity);

    // enabled が変化したらエンジン再起動
    if (prev.enabled !== this.config.enabled) {
      if (this.video) {
        this.rebuildEngine();
      }
    }
  }

  /** 表示対象のコメント一覧をセット */
  setComments(comments: NNDDREComment[]): void {
    if (comments === this.comments) return; // 同一参照 → スキップ
    this.comments = comments;
    if (this.video) {
      this.rebuildEngine();
    }
  }

  /** 描画開始 */
  start(video: HTMLVideoElement): void {
    this.stop();
    this.video = video;
    this.rebuildEngine();
    const loop = (): void => {
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** 描画停止 */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rebuildSeq++; // 待機中の rebuildEngine RAF コールバックを無効化
    this.nc?.destroy();
    this.nc = null;
    this.video = null;
    this.lastVpos = -1;
    this.clearCanvas();
  }

  /** seek されたら呼ぶ */
  onSeek(): void {
    if (this.video && this.nc) {
      const vpos = this.video.currentTime * 100;
      this.nc.drawCanvas(vpos, true);
      this.lastVpos = vpos;
    }
  }

  /** Canvas サイズ変更時に呼ぶ */
  onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const w = Math.round(width);
    const h = Math.round(height);
    // サイズが変わっていなければ rebuild 不要
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    // NiconiComments はコンストラクタ時にスケールを計算するため再生成が必要
    if (this.video) {
      this.rebuildEngine();
    }
  }

  // -----------------------------------------------------------------------

  /**
   * NiconiComments インスタンスを (再) 生成する。
   * コメントデータ・設定・キャンバスサイズが変わったときに呼ぶ。
   */
  private rebuildEngine(): void {
    this.nc?.destroy();
    this.nc = null;
    this.lastVpos = -1;

    if (!this.config.enabled) {
      this.clearCanvas();
      return;
    }

    // 複数のトリガ (setComments/setConfig/onResize) が同一フレーム内で連続して
    // 呼ばれても canvas 差し替えとエンジン生成を1回にまとめるため、RAF で遅延し
    // rebuildSeq で最後の1回だけ実行する。
    const seq = ++this.rebuildSeq;
    requestAnimationFrame(() => {
      if (seq !== this.rebuildSeq) return; // 待機中により新しい rebuild が来ていれば破棄
      this.createEngine();
    });
  }

  private createEngine(): void {
    // 直前の destroy() で loseContext 済みの canvas は再利用不可。
    // 毎回まっさらな canvas に差し替えてから NiconiComments を生成する。
    this.swapToFreshCanvas();

    // Canvas サイズが未確定の場合は getBoundingClientRect() で補完、
    // それでも 0 なら ResizeObserver の発火を待つ
    if (this.canvas.width <= 0 || this.canvas.height <= 0) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.canvas.width = Math.round(rect.width);
        this.canvas.height = Math.round(rect.height);
      } else {
        return; // レイアウト未確定 — onResize() で再呼び出しされる
      }
    }

    const formatted = this.toFormattedComments(
      this.filterComments(this.comments)
    );

    // dropShadow=false → contextStrokeOpacity=0 (縁取り非表示)
    // outlineIntensity: 'light'=0.15 / 'normal'=0.3 (デフォルト0.4の0.75倍)
    const strokeOpacity = !this.config.dropShadow
      ? 0
      : this.config.outlineIntensity === 'normal' ? 0.3 : 0.15;

    // ライブラリ内部は setScale(rendererSize.width / canvasWidth, rendererSize.height / canvasHeight)
    // で横方向・縦方向を個別にスケールする。canvasWidth/canvasHeight のアスペクト比が
    // 実際の canvas と食い違うと scaleX ≠ scaleY になり文字が縦横不均一に歪むため、
    // 実アスペクト比を保った仮想サイズを渡す (NORMAL_VIRTUAL_HEIGHT 基準)。
    const aspect = this.canvas.width / this.canvas.height;
    const virtualHeight = CommentRenderer.NORMAL_VIRTUAL_HEIGHT;
    const virtualWidth = virtualHeight * aspect;

    this.nc = new NiconiComments(this.canvas, formatted, {
      format: 'formatted',
      // flash モード: Flash 時代の全コマンド (full/ender/AA 等) に対応
      mode: 'flash',
      // video は渡さない (映像は別 <video> 要素で描画済み)
      video: undefined,
      // 遅延レイアウト: 初期化コストを下げる
      lazy: true,
      // CA 保護: 同時刻コメントアートを専用レイヤーに分離
      keepCA: this.config.keepCA,
      config: {
        // 文字縁取り設定
        contextStrokeOpacity: strokeOpacity,
        canvasWidth: virtualWidth,
        canvasHeight: virtualHeight
      }
    });

    this.canvas.style.opacity = String(this.config.opacity);
  }

  private tick(): void {
    if (!this.video || !this.nc) {
      if (!this.config.enabled) this.clearCanvas();
      return;
    }
    const vpos = this.video.currentTime * 100;
    this.nc.drawCanvas(vpos);
    this.lastVpos = vpos;
  }

  /**
   * NNDDREComment[] → FormattedComment[]
   * vpos = vposMs / 10 (1/100秒単位)
   * mail = スペース区切りコマンド → string[]
   */
  private toFormattedComments(comments: NNDDREComment[]): FormattedComment[] {
    const userMap = new Map<string, number>();
    return comments.map((c) => {
      let userId = userMap.get(c.userId);
      if (userId === undefined) {
        userId = userMap.size;
        userMap.set(c.userId, userId);
      }
      return {
        id: c.no,
        vpos: Math.floor(c.vposMs / 10),
        content: c.text,
        date: c.date,
        date_usec: 0,
        owner: false,
        premium: c.isPremium,
        mail: c.mail ? c.mail.split(/\s+/).filter(Boolean) : [],
        user_id: userId,
        layer: -1,
        is_my_post: false
      } satisfies FormattedComment;
    });
  }

  /** NGリストで除外 */
  private filterComments(comments: NNDDREComment[]): NNDDREComment[] {
    const strength = this.config.ngStrength ?? 'medium';
    const spamUserIds = strength === 'strong' ? this.detectSpamUsers(comments) : null;
    return comments.filter((c) => {
      if (!c.isShow) return false;
      if (spamUserIds?.has(c.userId)) return false;
      for (const ng of this.config.ngList) {
        if (strength !== 'weak' && ng.type === NgListItemType.WORD && c.text.includes(ng.value))
          return false;
        if (ng.type === NgListItemType.WORD_EXACT && c.text === ng.value)
          return false;
        if (ng.type === NgListItemType.USER_ID && c.userId === ng.value)
          return false;
        if (ng.type === NgListItemType.COMMAND && c.mail.includes(ng.value))
          return false;
      }
      return true;
    });
  }

  /**
   * strong モード用: 同一ユーザーが SPAM_WINDOW_MS 以内に SPAM_THRESHOLD 件以上
   * 投稿している場合、そのユーザーの全コメントを連投スパムとして扱う。
   */
  private detectSpamUsers(comments: NNDDREComment[]): Set<string> {
    const SPAM_WINDOW_MS = 10_000;
    const SPAM_THRESHOLD = 5;
    const byUser = new Map<string, number[]>();
    for (const c of comments) {
      let arr = byUser.get(c.userId);
      if (!arr) {
        arr = [];
        byUser.set(c.userId, arr);
      }
      arr.push(c.vposMs);
    }
    const spam = new Set<string>();
    for (const [userId, times] of byUser) {
      if (times.length < SPAM_THRESHOLD) continue;
      times.sort((a, b) => a - b);
      for (let i = 0; i + SPAM_THRESHOLD - 1 < times.length; i++) {
        if (times[i + SPAM_THRESHOLD - 1] - times[i] <= SPAM_WINDOW_MS) {
          spam.add(userId);
          break;
        }
      }
    }
    return spam;
  }

  /**
   * canvas.getContext('2d') は呼ばない — 一度でも呼ぶとその canvas は
   * 以後 'webgl2' コンテキストを取得できなくなる (ブラウザ仕様上、同一
   * canvas 要素で異なる種類のコンテキストは共存不可)。width の自己代入は
   * getContext を呼ばずに canvas の内容を全クリアできる。
   */
  private clearCanvas(): void {
    this.canvas.width = this.canvas.width;
  }
}
