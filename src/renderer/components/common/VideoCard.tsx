import React, { useEffect, useState } from 'react';

/**
 * 検索結果・ランキング・マイリストで共通利用する動画カード。
 */
export interface VideoCardData {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  /** 秒数または "M:SS" 形式 */
  length: number | string;
  viewCount: number;
  commentCount: number;
  mylistCount: number;
  likeCount?: number;
  registeredAt?: Date | string;
  rank?: number;
  description?: string;
  /** 投稿者情報 (フォロー新着など) */
  authorIconUrl?: string;
  authorId?: string;
  authorNickname?: string;
  /** チャンネル動画かどうか (未加入だと再生できない場合がある) */
  isChannelVideo?: boolean;
}

interface Props {
  data: VideoCardData;
  onPlay?: (videoId: string) => void;
  onDownload?: (videoId: string) => void;
  onOpenInfo?: (videoId: string) => void;
  /** ニコニコで開く */
  onNiconico?: (videoId: string) => void;
  /** ユーザーページを開く */
  onUserPage?: (userId: string) => void;
  /** 音声のみ再生 */
  onPlayAudioOnly?: (videoId: string) => void;
  /** 横並び表示 (リスト) ⇄ 縦並び表示 (グリッド) */
  layout?: 'grid' | 'list';
  /** ライブラリにDL済みかどうか */
  isDownloaded?: boolean;
}

export function VideoCard({
  data,
  onPlay,
  onDownload,
  onOpenInfo,
  onNiconico,
  onUserPage,
  onPlayAudioOnly,
  layout = 'grid',
  isDownloaded = false
}: Props): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const menu = ctxMenu && (
    <ContextMenuPopup
      x={ctxMenu.x}
      y={ctxMenu.y}
      onClose={() => setCtxMenu(null)}
    >
      {onPlay && (
        <MenuItem onClick={() => { onPlay(data.videoId); setCtxMenu(null); }}>▶ 再生</MenuItem>
      )}
      {onPlayAudioOnly && (
        <MenuItem onClick={() => { onPlayAudioOnly(data.videoId); setCtxMenu(null); }}>♪ 音声のみ再生</MenuItem>
      )}
      {onDownload && (
        <MenuItem onClick={() => { onDownload(data.videoId); setCtxMenu(null); }}>
          {isDownloaded ? '💬 コメント再取得' : '⬇ ダウンロード'}
        </MenuItem>
      )}
      {onNiconico && (
        <MenuItem onClick={() => { onNiconico(data.videoId); setCtxMenu(null); }}>🌐 ニコニコで開く</MenuItem>
      )}
    </ContextMenuPopup>
  );

  if (layout === 'list') {
    return (
      <div className="flex gap-2 p-2 bg-nndd-panel hover:bg-nndd-border rounded items-start" onContextMenu={handleContextMenu}>
        <Thumb data={data} small />
        <div className="flex-1 min-w-0">
          <Title data={data} onUserPage={onUserPage} />
          <Stats data={data} />
        </div>
        <Actions
          data={data}
          onPlay={onPlay}
          onDownload={onDownload}
          onOpenInfo={onOpenInfo}
          onNiconico={onNiconico}
          onUserPage={onUserPage}
          isDownloaded={isDownloaded}
        />
        {menu}
      </div>
    );
  }
  return (
    <div className="bg-nndd-panel hover:bg-nndd-border rounded overflow-hidden flex flex-col" onContextMenu={handleContextMenu}>
      <Thumb data={data} />
      <div className="p-2 flex-1 flex flex-col">
        <Title data={data} onUserPage={onUserPage} />
        <Stats data={data} />
        <div className="mt-auto pt-2">
          <Actions
            data={data}
            onPlay={onPlay}
            onDownload={onDownload}
            onOpenInfo={onOpenInfo}
            onNiconico={onNiconico}
            onUserPage={onUserPage}
            isDownloaded={isDownloaded}
          />
        </div>
      </div>
      {menu}
    </div>
  );
}

function Thumb({
  data,
  small
}: {
  data: VideoCardData;
  small?: boolean;
}): JSX.Element {
  return (
    <div
      className={[
        'relative bg-black flex-shrink-0 overflow-hidden aspect-video',
        small ? 'w-32' : 'w-full'
      ].join(' ')}
    >
      {data.thumbnailUrl && (
        <img
          src={data.thumbnailUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            // nndd-re-local:// キャッシュが失われた場合などに画像を非表示にする
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <span className="absolute right-1 bottom-1 bg-black/70 text-white text-xs px-1 rounded">
        {formatLen(data.length)}
      </span>
      {data.rank !== undefined && (
        <span className="absolute left-1 top-1 bg-nndd-accent text-white text-xs px-2 py-0.5 rounded font-bold">
          {data.rank}位
        </span>
      )}
      {data.isChannelVideo && (
        <span
          className="absolute right-1 top-1 bg-yellow-500 text-black text-xs px-1.5 py-0.5 rounded font-bold"
          title="チャンネル動画 (未加入だと再生できない場合があります)"
        >
          CH
        </span>
      )}
    </div>
  );
}

function Title({
  data,
  onUserPage
}: {
  data: VideoCardData;
  onUserPage?: (id: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-start gap-1.5 mb-1">
      {data.authorIconUrl && (
        <button
          onClick={() => data.authorId && onUserPage?.(data.authorId)}
          className="flex-shrink-0 mt-0.5"
          title={data.authorNickname ?? '投稿者ページ'}
        >
          <img
            src={data.authorIconUrl}
            alt=""
            className="w-5 h-5 rounded-full object-cover"
            loading="lazy"
          />
        </button>
      )}
      <div
        className="text-sm font-medium line-clamp-2"
        title={data.title}
      >
        {data.title}
      </div>
    </div>
  );
}

function Stats({ data }: { data: VideoCardData }): JSX.Element {
  const hasStats = data.viewCount !== 0 || data.commentCount !== 0 || data.mylistCount !== 0 || (data.likeCount !== undefined && data.likeCount !== 0);
  return (
    <div className="text-xs text-nndd-subtext flex flex-wrap gap-x-2 gap-y-0.5">
      {hasStats && <>
        <span>▶ {fmt(data.viewCount)}</span>
        <span>💬 {fmt(data.commentCount)}</span>
        <span>📑 {fmt(data.mylistCount)}</span>
        {data.likeCount !== undefined && <span>♡ {fmt(data.likeCount)}</span>}
      </>}
      {data.registeredAt && (
        <span className="ml-auto">{formatDate(data.registeredAt)}</span>
      )}
    </div>
  );
}

function Actions({
  data,
  onPlay,
  onDownload,
  onOpenInfo,
  onNiconico,
  onUserPage,
  isDownloaded = false
}: {
  data: VideoCardData;
  onPlay?: (id: string) => void;
  onDownload?: (id: string) => void;
  onOpenInfo?: (id: string) => void;
  onNiconico?: (id: string) => void;
  onUserPage?: (userId: string) => void;
  isDownloaded?: boolean;
}): JSX.Element {
  return (
    <div className="flex gap-1 flex-wrap">
      {onPlay && (
        <button
          onClick={() => onPlay(data.videoId)}
          className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80"
        >
          再生
        </button>
      )}
      {onDownload && (
        <button
          onClick={() => onDownload(data.videoId)}
          className={
            isDownloaded
              ? 'text-xs px-2 py-0.5 bg-green-700 text-white rounded hover:bg-green-600'
              : 'text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white'
          }
          title={isDownloaded ? 'コメントのみ再取得' : 'ダウンロード'}
        >
          {isDownloaded ? 'DL' : 'DL'}
        </button>
      )}
      {onNiconico && (
        <button
          onClick={() => onNiconico(data.videoId)}
          className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
          title="ニコニコで開く"
        >
          ニコ動
        </button>
      )}
      {onUserPage && data.authorId && (
        <button
          onClick={() => onUserPage(data.authorId!)}
          className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
          title={data.authorNickname ? `${data.authorNickname} のページ` : 'ユーザーページ'}
        >
          ユーザー
        </button>
      )}
      {onOpenInfo && (
        <button
          onClick={() => onOpenInfo(data.videoId)}
          className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
        >
          情報
        </button>
      )}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1)}億`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return n.toLocaleString('ja-JP');
}

function formatLen(v: number | string): string {
  if (typeof v === 'string') return v;
  if (!v || v <= 0) return '-:--';
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP');
}

export function ContextMenuPopup({
  x, y, onClose, children
}: {
  x: number; y: number;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-ctx-menu]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const top = Math.min(y, window.innerHeight - 160);
  const left = Math.min(x, window.innerWidth - 200);

  return (
    <div
      data-ctx-menu
      className="fixed bg-nndd-panel border border-nndd-border rounded shadow-lg py-1 text-xs z-[9999]"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function MenuItem({ onClick, children }: {
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left hover:bg-nndd-border whitespace-nowrap"
    >
      {children}
    </button>
  );
}
