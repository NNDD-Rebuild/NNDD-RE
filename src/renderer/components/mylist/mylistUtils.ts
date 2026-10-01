import type { MyList, MyListItem, Playlist, PlaylistItem, RssTypeValue } from '@shared/types';
import { RssType } from '@shared/types';
import type { VideoCardData } from '../common/VideoCard';

/** 右ペインに表示中のリスト (リモートマイリスト or ローカルプレイリスト) */
export type Selected =
  | { kind: 'mylist'; mylist: MyList }
  | { kind: 'playlist'; playlist: Playlist };

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
