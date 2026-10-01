export interface NicowariMedia {
  /** MIME タイプ (image/jpeg, audio/mpeg 等) */
  mime: string;
  data: Uint8Array;
}

/**
 * ニコ割 SWF (`タイトル - [sm12345][Nicowari][nm67890].swf`) から取り出した中身。
 * Flash を実行せず、埋め込まれた画像と音声だけを取り出して再生する。
 */
export interface NicowariContent {
  /** ステージ幅 (px) */
  width: number;
  /** ステージ高さ (px) */
  height: number;
  /** 再生時間 (秒)。フレーム数 / フレームレート */
  durationSec: number;
  /** 埋め込み画像 (最も大きいもの) */
  image: NicowariMedia | null;
  /** 埋め込み音声 (MP3) */
  audio: NicowariMedia | null;
  /** 音声はあるが対応していない形式だった場合の形式名 (ADPCM 等) */
  unsupportedAudioFormat: string | null;
}
