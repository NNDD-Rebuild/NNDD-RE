/**
 * ニコニコのウォッチページから取得する情報。
 * 新API (V3 DMS) で利用するため、Niconicome-develop の V2/V3 構造を踏まえる。
 */
export interface WatchPageInfo {
  /** 動画ID */
  videoId: string;
  /** タイトル */
  title: string;
  /** 説明 */
  description: string;
  /** 再生時間 (秒) */
  duration: number;
  /** タグ一覧 */
  tags: string[];
  /** サムネイル */
  thumbnail: {
    url: string;
    largeUrl: string;
  };
  /** カウンタ */
  count: {
    view: number;
    comment: number;
    mylist: number;
    like: number;
  };
  /** 投稿日 */
  registeredAt: string;
  /** 投稿者 */
  owner: {
    id: number;
    nickname: string;
    iconUrl: string;
  } | null;
  /** チャンネル (チャンネル動画の場合) */
  channel: {
    id: string;
    name: string;
    isOfficialAnime: boolean;
  } | null;
  /** DMSドメインの動画 (新システム) かどうか */
  isDMS: boolean;
  /** ダウンロード可能か */
  isDownloadable: boolean;
  /** 暗号化されているか (DRM) */
  isEncrypted: boolean;
  /** エコノミーかどうか */
  isEconomy: boolean;
  /** コメントスレッド情報 */
  commentThreads: CommentThreadInfo[];
  /** ユーザーキー */
  userKey: string;
  /** スレッドキー (V3コメントAPI用) */
  threadKey: string | null;
  /** Niconicome の DMC レスポンスJSON (heartbeat用、生文字列) */
  dmcResponseJsonData: string | null;
  /** マスター M3U8 URL (DMS の場合) */
  contentUrl: string | null;
  /** セッションID */
  sessionId: string | null;
  /** コメントサーバーURL */
  commentServerUrl: string;
  /**
   * DMS (domand) アクセス用キー。
   * `media.domand.accessRightKey` から取得し、
   * /v1/watch/{id}/access-rights/hls の X-Access-Right-Key ヘッダーで送る。
   */
  domandAccessRightKey: string | null;
  /** DMSの映像ストリーム候補 (id, qualityLevel) */
  domandVideos: DomandStreamCandidate[];
  /** DMSの音声ストリーム候補 */
  domandAudios: DomandStreamCandidate[];
  /**
   * DMC 旧仕様のセッション作成用 JSON (動画にdomandが無い場合に使用)。
   * DMCサーバーへの POST /api/sessions の body のテンプレートとして使う。
   */
  dmcSessionRequestJson: string | null;
  /** nvComment.params (コメント取得 POST body の params に直接使う) */
  nvCommentParams: {
    targets: Array<{ id: string; fork: string }>;
    language: string;
  } | null;
  /** 所属シリーズ (未所属なら null) */
  series: { id: string; title: string } | null;
}

/**
 * DMS の videos[] / audios[] 配下の項目。
 *  - id: "video-h264-720p" 等
 *  - isAvailable: 利用可能なら true
 *  - qualityLevel: 数値が大きいほど高品質
 */
export interface DomandStreamCandidate {
  id: string;
  isAvailable: boolean;
  qualityLevel: number;
  label?: string;
  bitRate?: number;
  width?: number;
  height?: number;
}

export interface CommentThreadInfo {
  id: string;
  fork: string;
  isActive: boolean;
  isDefaultPostTarget: boolean;
  isEasyCommentPostTarget: boolean;
  isLeafRequired: boolean;
  isOwnerThread: boolean;
  isThreadkeyRequired: boolean;
  threadkey: string | null;
  is184Forced: boolean;
  label: string;
}

/**
 * HLS のストリーム情報 (バリアントごと)
 */
export interface HlsStreamInfo {
  /** 解像度 (高さ, 例: 720) */
  resolution: number;
  /** ビットレート */
  bandwidth: number;
  /** バリアントプレイリストURL */
  url: string;
  /** 紐づく音声グループID */
  audioGroupId?: string;
}

/**
 * HLS のオーディオ情報
 */
export interface HlsAudioInfo {
  /** グループID */
  groupId: string;
  /** 言語 */
  language?: string;
  /** 名前 */
  name?: string;
  /** プレイリストURL */
  url: string;
}

/**
 * HLS セグメント (映像/音声共通)
 */
export interface HlsSegment {
  /** 連番 */
  index: number;
  /** ファイル名 */
  filename: string;
  /** セグメントURL */
  url: string;
  /** 再生長 (秒) */
  duration: number;
}

/**
 * AES-128 鍵情報
 */
export interface HlsKeyInfo {
  /** 鍵URL */
  url: string;
  /** IV (16進文字列) */
  iv: string;
  /** 取得後の Base64 鍵 */
  keyBase64?: string;
}

/**
 * バリアント分のメタデータ (stream.json)
 */
export interface VariantStreamData {
  resolution: number;
  bandwidth: number;
  videoKey: string;
  audioKey: string;
  videoIV: string;
  audioIV: string;
  videoMapFileName: string;
  audioMapFileName: string;
  videoSegments: { fileName: string; duration: string }[];
  audioSegments: { fileName: string; duration: string }[];
}

export interface StreamJson {
  streams: VariantStreamData[];
}
