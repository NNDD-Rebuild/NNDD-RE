import { NicoApi } from '../constants/api';
import { isLiveProgramId } from './liveId';

/**
 * ニコニコのページ URL 組み立て。main / renderer 共通。
 * ID はエンコードせずそのまま連結する (呼び出し側で検証済みの ID を渡す前提)。
 */

/**
 * 動画ページ: https://www.nicovideo.jp/watch/{videoId}。
 * 保存した生放送 (lv12345) はライブラリで動画と同じ枠に並ぶため、生放送ページ (live.nicovideo.jp) を返す
 */
export function watchUrl(videoId: string | number): string {
  const id = String(videoId);
  return isLiveProgramId(id) ? liveWatchUrl(id) : `${NicoApi.WATCH_PAGE}${id}`;
}

/** ユーザーページ: https://www.nicovideo.jp/user/{userId} */
export function userUrl(userId: string | number): string {
  return `${NicoApi.USER_PAGE}${userId}`;
}

/** マイリストページ: https://www.nicovideo.jp/my/mylist/{mylistId} */
export function mylistUrl(mylistId: string | number): string {
  return `${NicoApi.MYLIST_PAGE}${mylistId}`;
}

/** シリーズページ: https://www.nicovideo.jp/series/{seriesId} */
export function seriesUrl(seriesId: string | number): string {
  return `${NicoApi.SERIES_PAGE}${seriesId}`;
}

/** チャンネルページ: https://ch.nicovideo.jp/{channelId} */
export function channelUrl(channelId: string): string {
  return `${NicoApi.CHANNEL_VIDEOS_BASE}${channelId}`;
}

/** 生放送ページ: https://live.nicovideo.jp/watch/{programId} */
export function liveWatchUrl(programId: string): string {
  return `${NicoApi.LIVE_WATCH_PAGE}${programId}`;
}
