import type { NNDDREVideo } from '@shared/types';
import { buildLocalUrl } from '@shared/constants';
import { extractBracketedVideoId } from '@shared/utils/videoId';

export type ViewMode = 'tag' | 'folder';
export type LibraryDisplayMode = 'table' | 'grid';
export type SortCol = 'videoName' | 'time' | 'playCount' | 'pubDate' | 'creationDate';
export type SortDir = 'asc' | 'desc';

export interface LanVideo {
  videoId: string;
  filename: string;
  isEconomy: boolean;
}

/** 左ペインで「LANライブラリ」を選択中であることを表す selectedFolder の特別値 */
export const LAN_FOLDER = '__lan__';

/** ローカル動画一覧 (グリッド / テーブル) の各行に渡す操作 */
export interface LibraryItemHandlers {
  onClick: (v: NNDDREVideo, e: React.MouseEvent) => void;
  onPlay: (v: NNDDREVideo) => void;
  onDragStart: (e: React.DragEvent, v: NNDDREVideo) => void;
  onContextMenu: (e: React.MouseEvent, v: NNDDREVideo) => void;
  onToggleFavorite: (v: NNDDREVideo) => void;
  onOpenFolder: (v: NNDDREVideo) => void;
  onOpenNiconico: (v: NNDDREVideo) => void;
  onDelete: (v: NNDDREVideo) => void;
}

/** ライブラリ動画名 (`タイトル - [sm12345]`) から動画IDを取り出す。無ければ null */
export function extractVideoId(videoName: string): string | null {
  return extractBracketedVideoId(videoName);
}

export function thumbPrimaryUrl(v: NNDDREVideo): string {
  const base = v.uri.replace(/\.[^.]+$/, '');
  return buildLocalUrl(base + '[ThumbImg].jpeg');
}

export function thumbFallbackUrl(v: NNDDREVideo): string {
  const base = v.uri.replace(/\.[^.]+$/, '');
  return buildLocalUrl(base + '.jpg');
}

export function isAudioOnlyVideo(v: NNDDREVideo): boolean {
  return v.uri.toLowerCase().endsWith('.m4a');
}

export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
