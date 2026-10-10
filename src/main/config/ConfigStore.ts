import Store from 'electron-store';
import type { GitHubSyncConfig, DiscordRpcConfig, WebhookNotifyConfig, LiveRecordReservation } from '@shared/types';
import { COMMENT_FONT_FAMILY } from '@shared/constants';

/**
 * アプリ全体の設定。
 * 元: src/org/mineap/util/config/ConfigManager.as
 */
/** 内蔵HTTPサーバーの待受範囲 */
export type HttpBindMode = 'loopback' | 'lan' | 'tailscale';

/** 設定から待受範囲を決める。bindMode が無ければ従来の allowExternal から導出する */
export function resolveBindMode(cfg: { bindMode?: HttpBindMode; allowExternal?: boolean }): HttpBindMode {
  if (cfg.bindMode === 'loopback' || cfg.bindMode === 'lan' || cfg.bindMode === 'tailscale') return cfg.bindMode;
  return cfg.allowExternal ? 'lan' : 'loopback';
}

export interface NnddConfig {
  /** ライブラリのルートディレクトリ (空ならデフォルト) */
  libraryRoot: string;

  /** 同時ダウンロード数 */
  maxConcurrentDownloads: number;
  /** リトライ回数 */
  downloadRetryCount: number;
  /**
   * DL完了後の次アイテム開始までのクールダウン (ms)。
   * 0 = 無効。コメント取得・動画DL完了後に適用。
   */
  downloadCooldownMs: number;

  /**
   * 動画DLの帯域制限 (Mbps)。0 = 無制限。
   * yt-dlp経路 (--limit-rate) / ネイティブHLS経路 (SegmentDownloader) 両方に適用。
   */
  downloadRateLimitMbps: number;

  /** yt-dlp 実行ファイルのパス (空なら自動探索) */
  ytDlpPath: string;

  /**
   * 動画DLにネイティブHLS実装 (yt-dlp非依存) を優先的に使うか。
   * true (デフォルト): まずネイティブ実装 (WatchSession+M3U8Parser+SegmentDownloader+FFmpegManager) を試し、
   *                    失敗時のみ yt-dlp にフォールバックする。
   * false: 常に yt-dlp を使用する (ネイティブ実装を無効化。トラブル時の緊急回避用)。
   */
  useNativeVideoDownloader: boolean;

  /**
   * ネイティブHLS実装での映像/音声mux方式。
   * 'mediabunny' (デフォルト): JS実装 (mediabunnyライブラリ) でstream copy mux。ffmpeg非依存。
   * 'ffmpeg': ffmpeg外部プロセスでstream copy mux。
   */
  downloadMuxImplementation: 'ffmpeg' | 'mediabunny';

  /** ffmpeg 実行ファイルのパス (空なら自動探索) */
  ffmpegPath: string;

  /** 生放送 (タイムシフト) のダウンロードを保存先の live フォルダにまとめるか */
  downloadLiveToSubfolder: boolean;

  /**
   * fetchAllComments で easy スレッド (増量コメント) を取得するか。
   * デフォルト false (スキップ)。true にすると DL時間が大幅増加する場合あり。
   */
  downloadEasyComments: boolean;

  /**
   * 新規DL時に過去コメントを全件取得 (fetchAllComments) するか。
   * デフォルト false (今コメ (fetchComments) のみ取得)。true にすると過去ログまで遡って取得する。
   */
  downloadAllComments: boolean;

  /**
   * 音声のみダウンロード時はコメント (過去ログ・今コメ双方) を取得しないか。
   * デフォルト true (音声のみDL時はコメントを取得しない)。
   */
  skipCommentsOnAudioOnly: boolean;

  /**
   * コメント取得で HTTP 429 (Too Many Requests) が来た時の待機秒数。
   * 0 = リトライなし (即 break)。デフォルト 185。
   */
  comment429RetryWaitSec: number;

  /**
   * 動画視聴・ダウンロード時に、ニコニコ動画本体へ視聴履歴を残さない (ゲスト扱いでアクセス)。
   * 対象は WatchInfoHandler の watch API / HTML フォールバック取得のみ。
   * デフォルト false (従来通り履歴を残す)。ON時は年齢制限/チャンネル会員限定動画が
   * 視聴・ダウンロードできない場合がある。
   */
  hideWatchHistory: boolean;

  /**
   * hideWatchHistory ON時、年齢制限/センシティブ動画等でゲスト扱いのため
   * watch情報取得が失敗した場合の挙動。
   * 'ask' (デフォルト): 視聴履歴を残して再取得するか、都度ダイアログで確認する。
   * 'allow': 常に履歴を残して自動的に再取得する。
   * 'deny': 常に再生をあきらめる (エラー表示のまま)。
   */
  sensitiveVideoHistoryPolicy: 'ask' | 'allow' | 'deny';

  /**
   * キャッシュルートディレクトリ (空なら userData/nndd-cache 配下)。
   * 映像キャッシュ: <cacheRoot>/cache/movie (カスタム) or userData/nndd-cache/movie (デフォルト)。
   * 画像キャッシュ: userData/nndd-cache/image (常に userData)。
   * 変更後は再起動が必要。
   */
  cacheRoot: string;

  /**
   * ランキング取得時にセンシティブ (閲覧注意) な動画を隠すか。
   * true (デフォルト): レスポンスの requireSensitiveMasking=true の動画を除外する。
   * false: 除外せずすべて表示する。
   */
  hideSensitiveContents: boolean;

  /**
   * 検索タブで使う検索APIの種類。
   *   - 'snapshot' (デフォルト): スナップショット検索API v2。日次更新のため新着動画が反映されるまで最大1日程度のラグがある。
   *   - 'nvapi': nvapi.nicovideo.jp/v2/search/video。ほぼリアルタイムだが検索結果にタグ情報を含まない。
   */
  searchApi: 'snapshot' | 'nvapi';

  /** 外部のプレイヤーで再生する (元: 本家の「外部のPlayerを使う」) */
  externalPlayer: {
    enabled: boolean;
    /** プレイヤーの実行ファイル (macOS は .app も可) */
    path: string;
  };

  /** 検索ワードを履歴 (DB) に保存する */
  saveSearchHistory: boolean;
  /** マイリストのURLを履歴 (DB) に保存する */
  saveMyListHistory: boolean;

  /** プレイヤー設定 */
  player: {
    volume: number;
    /**
     * ストリーミング再生モード。
     *   - 'native':    hls.js でニコニコCDNに直接アクセス (即時再生, Cookie/CORS は session.webRequest で処理)
     *   - 'hls':       HLS プロキシで即時再生 (StreamServer+HlsProxy 経由、URL書き換えのみ)
     *   - 'niconico':  ニコニコ公式プレイヤーを webview で埋め込み表示
     *                  (公式機能フル利用可、コメント制御・シークバー制御不可)
     */
    streamingMode: 'hls' | 'native' | 'niconico';
    /**
     * デフォルト画質。
     *   - 'highest': 常に最高画質 (デフォルト)
     *   - number: 指定高さ(px)以下で最大の画質。該当なしなら最高画質にフォールバック
     */
    defaultQuality: 'highest' | number;
    /**
     * NGフィルタ強度。
     *   - 'weak':   NGワードは完全一致のみ適用
     *   - 'medium': 部分一致も適用 (デフォルト)
     *   - 'strong': 上記に加え短時間の連投コメントも自動非表示
     */
    ngStrength: 'weak' | 'medium' | 'strong';
    /** コメント表示 */
    showComments: boolean;
    /** コメント不透明度 0..1 */
    commentOpacity: number;
    /** 表示秒数 */
    commentShowSeconds: number;
    /** 全コメントのサイズ倍率 (本家相当のbig/small指定とは別の、視聴者側全体スケール) */
    commentSizeScale: number;
    /** フォント */
    commentFontFamily: string;
    /** アンチエイリアス */
    commentAntiAlias: boolean;
    /** ボールド */
    commentBold: boolean;
    /** ドロップシャドウ (文字縁取り表示) */
    commentDropShadow: boolean;
    /**
     * 文字の縁の濃さ。
     *   - 'light': 薄い (0.2)
     *   - 'normal': 標準 (0.4)
     */
    commentOutlineIntensity: 'light' | 'normal';
    /** デフォルト再生速度 */
    playbackRate: number;
    /** 動画を切り替えても直前に選んだ再生速度を引き継ぐ (OFF時は毎回デフォルト再生速度) */
    keepPlaybackRate: boolean;
    /**
     * 音量ノーマライズ。ON にすると Web Audio API の DynamicsCompressorNode で
     * 動画間の音量差を平滑化する (静かな動画は持ち上げ、大音量はピークを抑える)。
     */
    volumeNormalize: boolean;
    /** リピート再生 */
    repeat: boolean;
    /**
     * niconicoモード: NNDD-REのニコニコログイン情報を WebContentsView に引き継ぐ
     * ON にすると `persist:niconico` パーティションに NNDD-RE 側 Cookie を注入する
     */
    niconicoInheritLogin: boolean;
    /**
     * コメント一覧の表示方式
     *   - 'tab':    サイドパネル内のタブとして表示 (デフォルト)
     *   - 'window': 浮動パネルとしてビデオ上に表示
     */
    commentListDisplay: 'tab' | 'window';
    /** サイドパネル幅 (px) */
    sidebarWidth: number;
    /**
     * 直前の動画でコメントウィンドウを開いていたか。
     * 次の動画再生時に自動オープンするために使用。
     */
    commentWindowAutoOpen: boolean;
    /** コメントウィンドウの最後のサイズ・位置 */
    commentWindowBounds?: {
      width: number;
      height: number;
      x: number;
      y: number;
    };
    /**
     * コメントアート (CA) 保護モード。
     * ONにすると同時刻の CA コメントを専用レイヤーに分離し、
     * 通常コメントと衝突しないようにする。
     */
    commentKeepCA: boolean;
    /** コメント一覧の各列の幅 (px) */
    commentColumnWidths: {
      vposMs: number;
      text: number;
      userId: number;
      date: number;
      no: number;
      mail: number;
    };
    /**
     * コントロールバーのUIサイズ。
     *   - 'small':  現在のサイズ (デフォルト)
     *   - 'normal': 現在の 1.3 倍
     *   - 'large':  現在の 1.5 倍
     */
    controlUiSize: 'small' | 'normal' | 'large';
    /** 動画リンク (sm/nm/so/ss) をNNDD-REプレイヤーで開く */
    openVideoLinkInPlayer: boolean;
    /** 前回の再生位置から続きを再生する (OFF時は常に最初から再生) */
    resumePlayback: boolean;
    /**
     * 投稿者コメントのニコスクリプト (＠ジャンプ) の扱い。
     *   - 'ask' (デフォルト): 別動画へ移る前に確認する (同一動画内の移動は確認なし)
     *   - 'auto': 確認せず移る
     *   - 'off': 実行しない
     */
    jumpCommand: 'ask' | 'auto' | 'off';
    /**
     * ウィンドウ表示 (非フルスクリーン) 時、下部コントロールバーを常時表示する。
     * OFF (デフォルト) 時は従来通りマウス操作なしで一定時間後に自動的にフェードアウトする。
     * フルスクリーン時の自動非表示挙動には影響しない。
     */
    controlsAlwaysVisible: boolean;
    /** ローカル再生時、同じフォルダの次の動画を自動で連続再生する (プレイヤーのチェックボックスで切り替え) */
    autoNextFolder: boolean;
    /** 過去ログ (過去コメント) の同時描画件数の上限。0 = 無制限 */
    pastCommentMaxCount: number;
  };

  /** UI 設定 */
  ui: {
    /** ダーク/ライト */
    theme: 'dark' | 'light';
    /** 起動時のタブ index */
    initialTab: number;
    /** ウィンドウ位置・サイズ */
    window: {
      width: number;
      height: number;
      x?: number;
      y?: number;
      maximized: boolean;
    };
    /**
     * ライブラリの表示形式
     *   - 'table': 一覧テーブル表示 (デフォルト)
     *   - 'grid':  グリッド表示 (YouTube風サムネイル大)
     */
    libraryViewMode: 'table' | 'grid';
    /**
     * ランキング・検索・マイリスト共通の表示形式 (ライブラリとは独立)
     *   - 'grid': グリッド表示 (デフォルト)
     *   - 'list': リスト表示
     */
    contentViewMode: 'grid' | 'list';
    /** ライブラリ一覧の初期ソート列 (renderer の SortCol と同じ値) */
    librarySortCol: 'videoName' | 'time' | 'playCount' | 'pubDate' | 'creationDate';
    /** ライブラリ一覧の初期ソート方向 */
    librarySortDir: 'asc' | 'desc';
  };

  /** 視聴履歴 */
  history: {
    /** ランキング・フォロー中・マイリストの動画カードに再生済みバッジを表示する */
    showWatchedBadge: boolean;
  };

  /** 内蔵HTTPサーバー */
  httpServer: {
    enabled: boolean;
    port: number;
    /** LAN内の他端末からのアクセスを許可 (0.0.0.0バインド)。bindMode が無い設定 (旧バージョン・バックアップ) の互換用 */
    allowExternal: boolean;
    /**
     * 待受範囲。未設定なら allowExternal から導出する (resolveBindMode)。
     * - loopback: このPCのみ (127.0.0.1)
     * - lan: LAN内の他端末にも公開 (0.0.0.0)
     * - tailscale: Tailscale の IP にだけバインド (アクセストークン必須)
     */
    bindMode?: HttpBindMode;
    /** 動画ファイルのストリーミング配信を許可 */
    allowVideo: boolean;
    /** マイリスト情報の共有を許可 */
    allowMyList: boolean;
    /** アクセストークン認証を要求する (トークン本体は SecretStore。ここには置かない: Gist バックアップの同期対象のため) */
    requireToken: boolean;
    /** Host ヘッダーとして追加で許可する名前 (`example.lan` / `*.example.lan`)。DNS リバインディング対策の例外 */
    allowedHosts: string[];
  };

  /** リモートNNDDサーバー (LANライブラリ参照、本家NNDD互換) */
  remoteNndd: {
    /** リモートNNDD接続を有効にするか */
    enabled: boolean;
    /** リモートNNDDのIPアドレスまたはホスト名 */
    address: string;
    /** リモートNNDDのポート番号 (本家デフォルト: 12300) */
    port: number;
  };

  /** システムトレイ */
  tray: {
    enabled: boolean;
    minimizeToTray: boolean;
  };

  /** 画像キャッシュ (サムネイル・ユーザーアイコン) */
  imageCache: {
    /** キャッシュを有効にするか */
    enabled: boolean;
    /** キャッシュの最大サイズ (MB)。0 = 無制限。上限超過時は古いものから削除。 */
    maxSizeMb: number;
  };

  /** ログレベル: 'standard' = 重要ログのみ, 'verbose' = 全ログ */
  logLevel: 'standard' | 'verbose';

  /** ログファイルの自動ローテーション設定 */
  logRotation: {
    /** 1ファイルあたりの最大サイズ (MB)。超過したら nndd.log.1 にローテート */
    maxSizeMb: number;
    /** 保持する世代数 (nndd.log.1 ～ nndd.log.<N>)。超過分は古いものから削除 */
    maxFiles: number;
  };

  /** 開発者オプション */
  developer: {
    /** 開発者モードを有効にするか */
    enabled: boolean;
    /** API ダンプ保存先 (相対または絶対パス) */
    apiDumpPath?: string;
    /** API ダンプ対象 */
    apiDumpTargets?: Array<'watch' | 'session' | 'comment'>;
  };

  /** 保存済み認証情報 (safeStorage で暗号化) */
  auth: {
    savedEmail?: string;
    /** base64 encoded encrypted password */
    savedPasswordEnc?: string;
  };

  /** GitHub Gist 設定バックアップ・同期 */
  githubSync: GitHubSyncConfig;

  /** Discord Rich Presence */
  discordRpc: DiscordRpcConfig;

  /** Webhook通知 (Discord/Slack自動判定) */
  webhookNotify: WebhookNotifyConfig;

  /** ニコニコ生放送 */
  live: {
    /** 別の番組を開くとき、新しいウィンドウで開くか (false なら既存の生放送ウィンドウで切り替える) */
    allowMultipleWindows: boolean;
    /** コメントリストの表示方式 (side: タブ表示 / window: 浮動ウィンドウ) */
    commentListDisplay: 'side' | 'window';
    /** コメントウィンドウを最前面に表示するか */
    commentWindowOnTop: boolean;
    /** 放送者の移動指示 (別番組へジャンプ) に自動で従うか。false なら案内バナーを出すだけ */
    autoFollowMoveOrder: boolean;
    /** フォロー中の放送者の番組が始まったら OS 通知を出すか */
    followNotify: boolean;
    /** 通知のための確認間隔 (分、最短 1) */
    followNotifyIntervalMin: number;
    /** 生放送を開くとき NCV (ニコ生コメントビューア) も起動するか */
    ncvEnabled: boolean;
    /** NCV 実行ファイルのパス */
    ncvPath: string;
    /** タイムシフト視聴のときも NCV を起動するか */
    ncvTimeshift: boolean;
    /** 生放送を開いてから NCV を起動するまでの待ち時間 (秒、0 で待たない) */
    ncvLaunchDelaySec: number;
    /** コメントウィンドウの位置・サイズ (前回閉じたとき) */
    commentWindowBounds?: { x: number; y: number; width: number; height: number };
  };

  /** 生放送の録画予約 (開始時刻になったら自動で録画を始める。始めたものは削除される) */
  liveRecordReservations: LiveRecordReservation[];

  /** 登録チャンネルの新着動画監視 (定期ポーリングしOS通知) */
  channelWatch: {
    enabled: boolean;
    /** ポーリング間隔 (分) */
    intervalMin: number;
  };

  /** アプリ自動更新 */
  update: {
    /**
     * 起動時のアップデート確認方式
     *   - 'ask':    確認してダウンロード・インストールもダイアログで都度尋ねる (デフォルト)
     *   - 'silent': 自動でダウンロードし、次回終了時に自動インストール (通知のみ)
     *   - 'off':    起動時は確認しない
     */
    mode: 'ask' | 'silent' | 'off';
    /**
     * アップデートチャンネル
     *   - 'stable': 正式版のみ (GitHub Releaseのpre-releaseを除外)
     *   - 'beta':   ベータ版 (pre-release) も対象に含める
     */
    channel: 'stable' | 'beta';
  };
}

const DEFAULTS: NnddConfig = {
  libraryRoot: '',
  maxConcurrentDownloads: 2,
  downloadRetryCount: 3,
  downloadCooldownMs: 0,
  downloadRateLimitMbps: 0,
  ytDlpPath: '',
  useNativeVideoDownloader: true,
  downloadMuxImplementation: 'mediabunny',
  ffmpegPath: '',
  downloadLiveToSubfolder: false,
  downloadEasyComments: false,
  downloadAllComments: false,
  skipCommentsOnAudioOnly: true,
  comment429RetryWaitSec: 185,
  hideWatchHistory: false,
  sensitiveVideoHistoryPolicy: 'ask',
  cacheRoot: '',
  hideSensitiveContents: true,
  searchApi: 'snapshot',
  externalPlayer: { enabled: false, path: '' },
  saveSearchHistory: true,
  saveMyListHistory: true,
  player: {
    volume: 1.0,
    streamingMode: 'native',
    defaultQuality: 'highest',
    ngStrength: 'medium',
    showComments: true,
    commentOpacity: 1.0,
    commentShowSeconds: 3,
    commentSizeScale: 1.0,
    commentFontFamily: COMMENT_FONT_FAMILY,
    commentAntiAlias: true,
    commentBold: false,
    commentDropShadow: true,
    commentOutlineIntensity: 'light',
    playbackRate: 1.0,
    keepPlaybackRate: false,
    volumeNormalize: false,
    repeat: false,
    niconicoInheritLogin: true,
    commentListDisplay: 'tab',
    sidebarWidth: 320,
    commentWindowAutoOpen: false,
    commentKeepCA: true,
    commentColumnWidths: {
      vposMs: 40,
      text: 160,
      userId: 72,
      date: 90,
      no: 28,
      mail: 48
    },
    controlUiSize: 'normal',
    openVideoLinkInPlayer: true,
    resumePlayback: false,
    jumpCommand: 'ask',
    controlsAlwaysVisible: true,
    autoNextFolder: false,
    pastCommentMaxCount: 0
  },
  ui: {
    theme: 'dark',
    initialTab: 0,
    window: {
      width: 1280,
      height: 800,
      maximized: false
    },
    libraryViewMode: 'table',
    contentViewMode: 'grid',
    librarySortCol: 'pubDate',
    librarySortDir: 'asc'
  },
  history: {
    showWatchedBadge: true
  },
  httpServer: {
    enabled: false,
    port: 12345,
    allowExternal: false,
    // 既定値を持たせると旧設定 (allowExternal=true) の導出が効かなくなるため undefined にする。
    // キー自体は CONFIG_SET の許可判定 (DEFAULT_CONFIG に存在するキーのみ) のために必要
    bindMode: undefined,
    allowVideo: true,
    allowMyList: true,
    requireToken: false,
    allowedHosts: []
  },
  remoteNndd: {
    enabled: false,
    address: '',
    port: 12300
  },
  tray: {
    enabled: true,
    minimizeToTray: true
  },
  imageCache: {
    enabled: true,
    maxSizeMb: 1000
  },
  logLevel: 'standard',
  logRotation: {
    maxSizeMb: 1,
    maxFiles: 3
  },
  developer: {
    enabled: false,
    apiDumpPath: undefined,
    apiDumpTargets: ['watch']
  },
  auth: {},
  githubSync: {
    profiles: [],
    activeProfileId: null
  },
  discordRpc: {
    enabled: false,
    clientId: '',
    showTitle: true,
    showThumbnail: true,
    showGithubButton: true
  },
  webhookNotify: {
    enabled: false,
    webhookUrl: '',
    notifyOnDownloadComplete: true,
    notifyOnDownloadFail: true
  },
  live: {
    allowMultipleWindows: false,
    commentListDisplay: 'side',
    commentWindowOnTop: true,
    autoFollowMoveOrder: false,
    followNotify: false,
    followNotifyIntervalMin: 5,
    ncvEnabled: false,
    ncvPath: '',
    ncvTimeshift: true,
    ncvLaunchDelaySec: 3
  },
  liveRecordReservations: [],
  channelWatch: {
    enabled: false,
    intervalMin: 30
  },
  update: {
    mode: 'ask',
    channel: 'stable'
  }
};

type NestedObject<V> = NonNullable<V> extends readonly unknown[] ? never
  : NonNullable<V> extends object ? NonNullable<V> : never;

/** NnddConfig のドット記法キー ('developer.apiDumpTargets' など) の一覧 */
export type ConfigDotPath<T = NnddConfig> = {
  [K in keyof T & string]: [NestedObject<T[K]>] extends [never]
    ? never
    : `${K}.${(keyof NestedObject<T[K]> & string) | ConfigDotPath<NestedObject<T[K]>>}`;
}[keyof T & string];

/** NnddConfig のトップレベルキー ('libraryRoot' など) */
export type ConfigTopLevelKey = keyof NnddConfig & string;

/** CONFIG_GET / CONFIG_SET で受け付けるキー (トップレベルキーとドット記法キー) */
export type ConfigKey = ConfigTopLevelKey | ConfigDotPath;

/** ドット記法キーが指す値の型。途中のオブジェクトが省略可能なら undefined を含める */
type ConfigValueAt<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? ConfigValueAt<NonNullable<T[K]>, Rest> | Extract<T[K], undefined>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * conf (electron-store の基盤) の型定義はドット記法キーの get を unknown として扱うため、
 * NnddConfig から値の型を引けるオーバーロードを先頭に足す。
 */
export type NnddConfigStore = {
  get<P extends ConfigDotPath>(key: P): ConfigValueAt<NnddConfig, P>;
} & Store<NnddConfig>;

let store: NnddConfigStore | null = null;

export function getConfigStore(): NnddConfigStore {
  if (!store) {
    store = new Store<NnddConfig>({
      name: 'nndd-config',
      defaults: DEFAULTS
    }) as NnddConfigStore;
  }
  return store;
}

export const DEFAULT_CONFIG = DEFAULTS;
