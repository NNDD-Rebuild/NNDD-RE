import type { MyListItem, RssTypeValue } from '@shared/types';
import { RssType } from '@shared/types';
import { extractMylistLikeId } from '@shared/utils/parseMylistUrl';
import { MyListClient } from './MyListClient';
import { ChannelClient } from '../channel/ChannelClient';

/**
 * myListUrl + type から適切なAPI/スクレイパーへ振り分けて動画一覧を取得する。
 * SERIES は別チャンネル (SERIES_FETCH) で処理するためここでは扱わない。
 */
export async function fetchMylistLikeItems(
  myListUrl: string,
  type: RssTypeValue,
  page: number,
  pageSize: number,
  cacheImages = true
): Promise<{ items: MyListItem[]; total: number }> {
  const id = extractMylistLikeId(myListUrl, type);
  if (!id) throw new Error(`invalid mylist url: ${myListUrl}`);

  switch (type) {
    case RssType.USER_UPLOAD_VIDEO:
      return MyListClient.fetchUserVideos(id, page, pageSize, cacheImages);
    case RssType.CHANNEL: {
      const { items, total } = await ChannelClient.fetchChannelVideos(id, page, cacheImages);
      return { items, total };
    }
    default:
      return MyListClient.fetchPublicMylist(id, page, pageSize, cacheImages);
  }
}

/**
 * myListUrl + type から表示名を取得する (追加フォームのプレビュー用)。
 */
export async function fetchMylistLikeName(
  myListUrl: string,
  type: RssTypeValue
): Promise<string | null> {
  const id = extractMylistLikeId(myListUrl, type);
  if (!id) return null;

  switch (type) {
    case RssType.USER_UPLOAD_VIDEO:
      return MyListClient.fetchUserName(id);
    case RssType.CHANNEL: {
      const { name } = await ChannelClient.fetchChannelVideos(id, 1);
      return name ?? null;
    }
    default: {
      const info = await MyListClient.fetchMylistInfo(id);
      return info?.name ?? null;
    }
  }
}
