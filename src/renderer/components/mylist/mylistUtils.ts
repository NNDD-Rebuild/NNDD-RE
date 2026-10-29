import type { MyList, MyListItem, Playlist, PlaylistItem, RssTypeValue } from '@shared/types';
import { RssType } from '@shared/types';
import type { VideoCardData } from '../common/VideoCard';

/** 右ペインに表示中のリスト (リモートマイリスト / ローカルプレイリスト / サーバー側のあとで見る) */
export type Selected =
  | { kind: 'mylist'; mylist: MyList }
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'watchLater' };

/** あとで見る (固定リスト) の表示名 */
export const WATCH_LATER_NAME = 'あとで見る';

/** マイリストのページサイズ (ページネーションはマイリストのみ) */
export const PAGE_SIZE = 100;

/** SERIES_FETCH の戻り値 */
export type SeriesFetchResult = {
  name: string;
  items: Array<{
    videoId: string; title: string; description: string;
    thumbnailUrl: string; length: string;
    pubDate: string; viewCount: number; commentCount: number;
    mylistCount: number; likeCount: number;
  }>;
} | null;

/** MyListItem → VideoCardData */
export function mylistItemToCard(it: MyListItem): VideoCardData {
  return {
    videoId: it.videoId,
    title: it.title,
    thumbnailUrl: it.thumbnailUrl,
    length: it.length,          // string "M:SS" → VideoCard が string 対応済み
    viewCount: it.viewCount,
    commentCount: it.commentCount,
    mylistCount: it.mylistCount,
    likeCount: it.likeCount,
    registeredAt: it.pubDate,   // 投稿日
    isChannelVideo: it.isChannelVideo,
  };
}

/** PlaylistItem → VideoCardData (追加時のスナップショットのみ、統計情報はなし) */
export function playlistItemToCard(it: PlaylistItem): VideoCardData {
  return {
    videoId: it.videoId,
    title: it.title,
    thumbnailUrl: it.thumbnailUrl,
    length: it.lengthSec,
    viewCount: 0,
    commentCount: 0,
    mylistCount: 0,
  };
}

export const ICON_PRESET_GROUPS: { label: string; icons: string[] }[] = [
  { label: 'カラー', icons: ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪'] },
  { label: 'カテゴリ', icons: ['🎵', '🎮', '🎨', '⚽', '🍳', '📚', '🎬', '✈️', '💻', '🌙', '💎', '🏆', '📌', '❤️', '😂', '🔥'] }
];

export function typeLabel(t: RssTypeValue): string {
  switch (t) {
    case RssType.MY_LIST: return '📑';
    case RssType.CHANNEL: return '📺';
    case RssType.COMMUNITY: return '👥';
    case RssType.USER_UPLOAD_VIDEO: return '👤';
    case RssType.SERIES: return '📚';
    default: return '?';
  }
}

export function typeNameJa(t: RssTypeValue): string {
  switch (t) {
    case RssType.MY_LIST: return 'マイリスト';
    case RssType.CHANNEL: return 'チャンネル';
    case RssType.COMMUNITY: return 'コミュニティ (終了済)';
    case RssType.USER_UPLOAD_VIDEO: return 'ユーザー投稿';
    case RssType.SERIES: return 'シリーズ';
    default: return '不明';
  }
}

/** マイリストの並び順 (default = 取得順) */
export type MylistSortKey =
  | 'default'
  | 'pubDate'
  | 'viewCount'
  | 'commentCount'
  | 'mylistCount'
  | 'likeCount'
  | 'length'
  | 'title';

export interface MylistSort {
  key: MylistSortKey;
  desc: boolean;
}

export const MYLIST_SORT_OPTIONS: { key: MylistSortKey; label: string }[] = [
  { key: 'default', label: '取得順' },
  { key: 'pubDate', label: '投稿日' },
  { key: 'viewCount', label: '再生数' },
  { key: 'commentCount', label: 'コメント数' },
  { key: 'mylistCount', label: 'マイリスト数' },
  { key: 'likeCount', label: 'いいね数' },
  { key: 'length', label: '再生時間' },
  { key: 'title', label: 'タイトル' }
];

export const DEFAULT_MYLIST_SORT: MylistSort = { key: 'default', desc: false };

/** "M:SS" / "H:MM:SS" / 秒数 → 秒 */
function lengthToSec(length: number | string): number {
  if (typeof length === 'number') return length;
  return length.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0);
}

/** 並び順を適用した新しい配列を返す。default かつ昇順のときは元の配列をそのまま返す */
export function sortMylistItems(items: VideoCardData[], sort: MylistSort): VideoCardData[] {
  if (sort.key === 'default' && !sort.desc) return items;
  const indexed = items.map((it, i) => ({ it, i }));
  const value = (it: VideoCardData): number | string => {
    switch (sort.key) {
      case 'pubDate':
        return it.registeredAt ? new Date(it.registeredAt).getTime() : 0;
      case 'viewCount':
        return it.viewCount;
      case 'commentCount':
        return it.commentCount;
      case 'mylistCount':
        return it.mylistCount;
      case 'likeCount':
        return it.likeCount ?? 0;
      case 'length':
        return lengthToSec(it.length);
      case 'title':
        return it.title;
      default:
        return 0;
    }
  };
  indexed.sort((a, b) => {
    const va = value(a.it);
    const vb = value(b.it);
    let cmp = 0;
    if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb, 'ja');
    else cmp = (va as number) - (vb as number);
    if (cmp !== 0) return sort.desc ? -cmp : cmp;
    return sort.key === 'default' && sort.desc ? b.i - a.i : a.i - b.i; // 同値は取得順を保つ (取得順の逆順だけは逆に並べる)
  });
  return indexed.map((x) => x.it);
}
