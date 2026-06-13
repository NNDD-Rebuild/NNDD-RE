import NiconiComments from '@xpadev-net/niconicomments';
import type { FormattedComment } from '@xpadev-net/niconicomments';
import {
  type NNDDREComment,
  type NgListItem,
  NgListItemType
} from '@shared/types';

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
}

export const DEFAULT_RENDER_CONFIG: CommentRenderConfig = {
  enabled: true,
  opacity: 1,
  fontFamily: '"MS PGothic", "MSPGothic", "Yu Gothic UI", "Meiryo", sans-serif',
  antiAlias: true,
  bold: false,
  dropShadow: true,
  outlineIntensity: 'light',
  baseFontSize: 36,
  sizeScale: 1,
  showSecNaka: 3,
  showSecFixed: 3,
  keepCA: true,
  ngList: []
};

export class CommentRenderer {
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement | null = null;
  private nc: NiconiComments | null = null;
  private comments: NNDDREComment[] = [];
  private config: CommentRenderConfig = { ...DEFAULT_RENDER_CONFIG };
  private rafId: number | null = null;
  private lastVpos = -1;
  private lastW = 0;
  private lastH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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

    // CanvasRenderer.setScale() は context.scale() を呼ぶため累積する。
    // NiconiComments を再生成するたびに canvas.width を再代入して
    // 2D context の transform をリセットする (サイズ変更なしでも必須)。
    this.canvas.width = this.canvas.width;

    const formatted = this.toFormattedComments(
      this.filterComments(this.comments)
    );

    // dropShadow=false → contextStrokeOpacity=0 (縁取り非表示)
    // outlineIntensity: 'light'=0.15 / 'normal'=0.3 (デフォルト0.4の0.75倍)
    const strokeOpacity = !this.config.dropShadow
      ? 0
      : this.config.outlineIntensity === 'normal' ? 0.3 : 0.15;

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
      // 文字縁取り設定
      config: {
        contextStrokeOpacity: strokeOpacity
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
    return comments.filter((c) => {
      if (!c.isShow) return false;
      for (const ng of this.config.ngList) {
        if (ng.type === NgListItemType.WORD && c.text.includes(ng.value))
          return false;
        if (ng.type === NgListItemType.USER_ID && c.userId === ng.value)
          return false;
        if (ng.type === NgListItemType.COMMAND && c.mail.includes(ng.value))
          return false;
      }
      return true;
    });
  }

  private clearCanvas(): void {
    const ctx = this.canvas.getContext('2d');
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
