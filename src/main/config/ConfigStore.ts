import Store from 'electron-store';

/**
 * アプリ全体の設定。
 * 元: src/org/mineap/util/config/ConfigManager.as
 */
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

  /** yt-dlp 実行ファイルのパス (空なら自動探索) */
  ytDlpPath: string;

  /** ffmpeg 実行ファイルのパス (空なら自動探索) */
  ffmpegPath: string;

  /** ffplay 実行ファイルのパス (空なら自動探索) */
  ffplayPath: string;

  /**
   * fetchAllComments で easy スレッド (増量コメント) を取得するか。
   * デフォルト false (スキップ)。true にすると DL時間が大幅増加する場合あり。
   */
  downloadEasyComments: boolean;

  /**
   * 新規DL時に過去コメントを全件取得 (fetchAllComments) するか。
   * デフォルト true。false にすると今コメ (fetchComments) のみ取得。
   */
  downloadAllComments: boolean;

  /**
   * コメント取得で HTTP 429 が来た時の待機秒数。
   * 0 = リトライなし (即 break)。デフォルト 60。
   */
  comment429RetryWaitSec: number;

  /**
   * キャッシュルートディレクトリ (空なら userData/nndd-cache 配下)。
   * 映像キャッシュ: <cacheRoot>/cache/movie (カスタム) or userData/nndd-cache/movie (デフォルト)。
   * 画像キャッシュ: userData/nndd-cache/image (常に userData)。
   * 変更後は再起動が必要。
   */
  cacheRoot: string;

  /** プレイヤー設定 */
  player: {
    volume: number;
    /**
     * ストリーミング再生モード。
     *   - 'cache':     yt-dlp で完全DL → Electron <video> で再生 (シーク可、コメント描画あり、待ち時間あり)
     *   - 'ffplay':    yt-dlp の stdout を ffplay 別ウィンドウ + キャッシュに同時書き込み
     *                  (再生開始までほぼ待ち時間ゼロ、ただしコメント描画/コントロール不可)
     *   - 'streaming': WatchSession で HLS URL を即取得 → hls.js でアプリ内即時再生 + バックグラウンドでyt-dlpキャッシュ作成
     *                  (コメント描画あり、待ち時間ほぼゼロ、シークはバッファ内のみ / キャッシュ完成後は完全シーク可)
     *   - 'niconico':  ニコニコ公式プレイヤーを webview で埋め込み表示
     *                  (公式機能フル利用可、コメント制御・シークバー制御不可)
     */
    /**
     * 'native':    hls.js でニコニコCDNに直接アクセス (即時再生, Cookie/CORS は session.webRequest で処理)
     * 'hls':       HLS プロキシで即時再生 (StreamServer+HlsProxy 経由, yt-dlp ベース)
     * 'niconico':  ニコニコ公式プレイヤー埋め込み
     */
    streamingMode: 'hls' | 'native' | 'niconico';
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
  };

  /** 内蔵HTTPサーバー */
  httpServer: {
    enabled: boolean;
    port: number;
    /** LAN内の他端末からのアクセスを許可 (0.0.0.0バインド) */
    allowExternal: boolean;
    /** 動画ファイルのストリーミング配信を許可 */
    allowVideo: boolean;
    /** マイリスト情報の共有を許可 */
    allowMyList: boolean;
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
}

const DEFAULTS: NnddConfig = {
  libraryRoot: '',
  maxConcurrentDownloads: 2,
  downloadRetryCount: 3,
  downloadCooldownMs: 0,
  ytDlpPath: '',
  ffmpegPath: '',
  ffplayPath: '',
  downloadEasyComments: false,
  downloadAllComments: false,
  comment429RetryWaitSec: 60,
  cacheRoot: '',
  player: {
    volume: 1.0,
    streamingMode: 'native',
    showComments: true,
    commentOpacity: 1.0,
    commentShowSeconds: 3,
    commentSizeScale: 1.0,
    commentFontFamily: '"MS PGothic", "MSPGothic", "Yu Gothic UI", "Meiryo", sans-serif',
    commentAntiAlias: true,
    commentBold: false,
    commentDropShadow: true,
    commentOutlineIntensity: 'light',
    playbackRate: 1.0,
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
    openVideoLinkInPlayer: false
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
    contentViewMode: 'grid'
  },
  httpServer: {
    enabled: false,
    port: 12345,
    allowExternal: false,
    allowVideo: true,
    allowMyList: true
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
  developer: {
    enabled: false,
    apiDumpPath: undefined,
    apiDumpTargets: ['watch']
  },
  auth: {}
};

let store: Store<NnddConfig> | null = null;

export function getConfigStore(): Store<NnddConfig> {
  if (!store) {
    store = new Store<NnddConfig>({
      name: 'nndd-config',
      defaults: DEFAULTS
    });
  }
  return store;
}

export const DEFAULT_CONFIG = DEFAULTS;
