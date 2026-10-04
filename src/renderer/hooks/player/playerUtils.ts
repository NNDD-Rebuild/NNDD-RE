import type {
  DomandStreamCandidate,
  NNDDREComment,
  OpenPlayerParams,
  WatchPageInfo
} from '@shared/types';
import { ensureCommandResolved } from '../../util/commentCommands';

/** プレイヤー起動パラメータ (main の PlayerManager から `nndd:player:init` で届く) */
export type InitParams = OpenPlayerParams;

/** VIDEO_GET_STREAM_URL の戻り値 */
export interface StreamUrlResult {
  contentUrl: string | null;
  isDMS: boolean;
  isHls?: boolean;
  ffplay?: boolean;
  niconico?: boolean;
  error?: string;
}

/** 再生中の動画の識別情報 (履歴・Discord・コメントウィンドウ等で参照) */
export interface PlayInfo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  /** Discord Rich Presence送信用。nndd-re-local://はDiscordから解決できないため、ImageCache適用前の生URLを別途保持 */
  discordThumbnailUrl?: string;
  isLocal: boolean;
}

/** 次動画のプリロード結果。videoId のみの場合は取得中 */
export interface PreloadEntry {
  videoId: string;
  watchInfo?: WatchPageInfo;
  stream?: StreamUrlResult;
}

/**
 * 設定の defaultQuality に従って画質候補から初期選択IDを決める。
 * available は qualityLevel (height) 降順ソート済みの前提。
 *   - 'highest': 先頭 (最高画質)
 *   - number: 指定高さ以下で最大のもの。該当なしなら最高画質にフォールバック
 */
export function pickDefaultQualityId(
  available: DomandStreamCandidate[],
  preset: 'highest' | number
): string | null {
  if (available.length === 0) return null;
  if (preset === 'highest') return available[0].id;
  const fit = available.find((v) => (v.height ?? 0) <= preset);
  return (fit ?? available[0]).id;
}

/**
 * 任意の 3 秒ウィンドウ内に同時表示されるコメントを maxCount 件に制限する。
 * スライディングウィンドウ (O(n)) で処理するため 10 万件でも高速。
 * maxCount=0 の場合は全件返す。
 */
export function limitSimultaneousComments(comments: NNDDREComment[], maxCount: number): NNDDREComment[] {
  if (maxCount <= 0 || comments.length === 0) return comments;
  const SHOW_MS = 3000; // NiconiComments デフォルト表示時間に合わせる
  // vposMs 昇順ソート (既にソート済みの場合はほぼコスト 0)
  const sorted = [...comments].sort((a, b) => a.vposMs - b.vposMs);
  const result: NNDDREComment[] = [];
  let winStart = 0; // result 内のウィンドウ先頭インデックス

  for (const c of sorted) {
    // ウィンドウ先頭を進める (表示期限切れコメントを除外)
    while (winStart < result.length && result[winStart].vposMs < c.vposMs - SHOW_MS) {
      winStart++;
    }
    const concurrent = result.length - winStart;
    if (concurrent < maxCount) {
      result.push(c);
    }
  }
  return result;
}

/**
 * ローカル再生時のコメントXML (+ 投稿者コメントXML) を読み込み、表示用のコメント配列を返す。
 * コメントXMLが無い場合は null (コメントを更新しない)。
 */
export async function readLocalComments(
  files: InitParams['localFiles']
): Promise<NNDDREComment[] | null> {
  if (!files?.commentXml) return null;
  const cs = await window.nndd.invoke<NNDDREComment[]>(
    window.nndd.channels.COMMENT_READ_LOCAL,
    files.commentXml
  );
  // ownerコメントXML (fork='1') を読んでマージ。@ジャンプ等で全件必要なのでサンプリングしない
  let ownerCs: NNDDREComment[] = [];
  if (files?.ownerCommentXml) {
    ownerCs = await window.nndd
      .invoke<NNDDREComment[]>(window.nndd.channels.COMMENT_READ_LOCAL, files.ownerCommentXml)
      .catch(() => []);
    // fork 属性が無い古いXML (本家NNDD等) でも投稿者コメントとして扱う (ニコスクリプト処理に必要)
    ownerCs = ownerCs.map((c) => (c.fork ? c : { ...c, fork: '1' }));
  }
  if (files?.nowCommentJson) {
    const nos = await window.nndd.invoke<number[]>(
      window.nndd.channels.COMMENT_NOW_IDS_READ,
      files.nowCommentJson
    );
    const noSet = new Set(nos);
    return [...cs.filter((c) => noSet.has(c.no)), ...ownerCs].map(ensureCommandResolved);
  }
  const MAX_COMMENTS = 1000;
  const sorted = [...cs].sort((a, b) => a.vposMs - b.vposMs);
  const sampled = sorted.length <= MAX_COMMENTS
    ? sorted
    : Array.from(
        { length: MAX_COMMENTS },
        (_, i) => sorted[Math.floor(i * sorted.length / MAX_COMMENTS)]
      );
  return [...sampled, ...ownerCs].map(ensureCommandResolved);
}
