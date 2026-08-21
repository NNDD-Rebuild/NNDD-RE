import React, { useEffect, useRef, useState } from 'react';
import { AddToPlaylistMenuItem } from './AddToPlaylistMenuItem';

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
  /** ダウンロード。第2引数 true で音声のみDL */
  onDownload?: (videoId: string, audioOnly?: boolean) => void;
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
  /** 再生済み (アプリ内履歴またはニコ動本家履歴のいずれかに存在) かどうか */
  isWatched?: boolean;
  /** 指定時のみ削除ボタンを表示 (プレイリストからの削除など汎用) */
  onRemove?: (videoId: string) => void;
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
  isDownloaded = false,
  isWatched = false,
  onRemove
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
      <AddToPlaylistMenuItem data={data} />
    </ContextMenuPopup>
  );

  if (layout === 'list') {
    return (
      <div
        className="flex gap-2 p-2 bg-nndd-panel hover:bg-nndd-border rounded items-start"
        onContextMenu={handleContextMenu}
        onDoubleClick={() => onPlay?.(data.videoId)}
      >
        <Thumb data={data} small isWatched={isWatched} />
        <div className="flex-1 min-w-0">
          <Title data={data} onUserPage={onUserPage} onPlay={onPlay} />
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
          onRemove={onRemove}
        />
        {menu}
      </div>
    );
  }
  return (
    <div
      className="bg-nndd-panel hover:bg-nndd-border rounded overflow-hidden flex flex-col"
      onContextMenu={handleContextMenu}
      onDoubleClick={() => onPlay?.(data.videoId)}
    >
      <Thumb data={data} isWatched={isWatched} />
      <div className="p-2 flex-1 flex flex-col">
        <Title data={data} onUserPage={onUserPage} onPlay={onPlay} />
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

const PREVIEW_HOVER_DELAY_MS = 500;

function Thumb({
  data,
  small,
  isWatched
}: {
  data: VideoCardData;
  small?: boolean;
  isWatched?: boolean;
}): JSX.Element {
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTimer = (): void => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleMouseEnter = (): void => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setShowPreview(true), PREVIEW_HOVER_DELAY_MS);
  };
  const handleMouseLeave = (): void => {
    clearHoverTimer();
    setShowPreview(false);
  };

  useEffect(() => clearHoverTimer, []);

  return (
    <div
      className={[
        'relative bg-black flex-shrink-0 overflow-hidden aspect-video',
        small ? 'w-32' : 'w-full'
      ].join(' ')}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
      {showPreview && <ThumbPreview videoId={data.videoId} />}
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
      {isWatched && (
        <span
          className="absolute left-1 bottom-1 bg-black/60 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full"
          title="視聴済み"
        >
          👁
        </span>
      )}
    </div>
  );
}

/**
 * サムネイルホバー時の冒頭プレビュー再生。
 * VIDEO_GET_PREVIEW_STREAM_URL は常にゲスト扱いで取得するため、視聴履歴には残らない。
 */
const PREVIEW_LOOP_SEC = 12;

type PreviewStreamResult = { contentUrl: string | null; isHls?: boolean; error?: string };

/**
 * React.StrictMode の二重effect実行で同一videoIdのプレビュー取得IPCが
 * 短時間に2回飛ぶのを防ぐための in-flight キャッシュ。
 * DMS session ensure 等サーバー側に負荷をかけるAPIを含むため、結果を使い回す。
 */
const previewRequestCache = new Map<string, Promise<PreviewStreamResult>>();

function getPreviewStreamUrl(videoId: string): Promise<PreviewStreamResult> {
  let p = previewRequestCache.get(videoId);
  if (!p) {
    p = window.nndd.invoke<PreviewStreamResult>(window.nndd.channels.VIDEO_GET_PREVIEW_STREAM_URL, videoId);
    previewRequestCache.set(videoId, p);
    p.finally(() => {
      setTimeout(() => {
        if (previewRequestCache.get(videoId) === p) previewRequestCache.delete(videoId);
      }, 2000);
    });
  }
  return p;
}

function ThumbPreview({ videoId }: { videoId: string }): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hls: import('hls.js').default | null = null;
    const videoEl = videoRef.current;

    (async () => {
      try {
        const result = await getPreviewStreamUrl(videoId);
        if (cancelled || !videoEl || !result.contentUrl) {
          if (!cancelled) setFailed(true);
          return;
        }
        if (result.isHls) {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (Hls.isSupported()) {
            const h = new Hls({ maxBufferLength: 15 });
            hls = h;
            h.attachMedia(videoEl);
            h.loadSource(result.contentUrl);
            h.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return;
              videoEl.play().then(() => setReady(true)).catch(() => setFailed(true));
            });
            h.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal && !cancelled) setFailed(true);
            });
            return;
          } else {
            videoEl.src = result.contentUrl;
          }
        } else {
          videoEl.src = result.contentUrl;
        }
        await videoEl.play();
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    };
  }, [videoId]);

  if (failed) return null;

  return (
    <video
      ref={videoRef}
      className={[
        'absolute inset-0 w-full h-full object-cover transition-opacity',
        ready ? 'opacity-100' : 'opacity-0'
      ].join(' ')}
      muted
      playsInline
      loop
      onTimeUpdate={(e) => {
        if (e.currentTarget.currentTime > PREVIEW_LOOP_SEC) e.currentTarget.currentTime = 0;
      }}
    />
  );
}

function Title({
  data,
  onUserPage,
  onPlay
}: {
  data: VideoCardData;
  onUserPage?: (id: string) => void;
  onPlay?: (id: string) => void;
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
        className="text-sm font-medium line-clamp-2 min-h-[2.5em] cursor-pointer hover:underline"
        title={data.title}
        onClick={(e) => {
          e.stopPropagation();
          onPlay?.(data.videoId);
        }}
      >
        {data.title}
      </div>
    </div>
  );
}

function Stats({ data }: { data: VideoCardData }): JSX.Element {
  const hasStats = data.viewCount !== 0 || data.commentCount !== 0 || data.mylistCount !== 0 || (data.likeCount !== undefined && data.likeCount !== 0);
  return (
    <div className="text-xs text-nndd-subtext flex flex-wrap gap-x-2 gap-y-0.5 min-h-[1.25em]">
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
  isDownloaded = false,
  onRemove
}: {
  data: VideoCardData;
  onPlay?: (id: string) => void;
  onDownload?: (id: string, audioOnly?: boolean) => void;
  onOpenInfo?: (id: string) => void;
  onNiconico?: (id: string) => void;
  onUserPage?: (userId: string) => void;
  isDownloaded?: boolean;
  onRemove?: (id: string) => void;
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
        <DownloadSplitButton
          videoId={data.videoId}
          isDownloaded={isDownloaded}
          onDownload={onDownload}
        />
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
      {onRemove && (
        <button
          onClick={() => onRemove(data.videoId)}
          className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-red-600 hover:text-white"
          title="削除"
        >
          削除
        </button>
      )}
    </div>
  );
}

function DownloadSplitButton({
  videoId,
  isDownloaded,
  onDownload
}: {
  videoId: string;
  isDownloaded: boolean;
  onDownload: (videoId: string, audioOnly?: boolean) => void;
}): JSX.Element {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const baseCls = isDownloaded
    ? 'bg-green-700 text-white hover:bg-green-600'
    : 'bg-nndd-border hover:bg-nndd-accent hover:text-white';

  return (
    <div className="relative inline-flex">
      <button
        onClick={() => onDownload(videoId)}
        className={`text-xs px-2 py-0.5 rounded-l ${baseCls}`}
        title={isDownloaded ? 'コメントのみ再取得' : 'ダウンロード'}
      >
        DL
      </button>
      <button
        ref={btnRef}
        onClick={() => {
          if (menuPos) {
            setMenuPos(null);
          } else {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setMenuPos({ x: r.left, y: r.bottom });
          }
        }}
        className={`text-[9px] px-0.5 py-0.5 rounded-r border-l border-white/30 ${baseCls}`}
        title="ダウンロード方式を選択"
      >
        ▼
      </button>
      {menuPos && (
        <ContextMenuPopup x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)}>
          <MenuItem onClick={() => { onDownload(videoId, false); setMenuPos(null); }}>
            ⬇ 通常ダウンロード
          </MenuItem>
          <MenuItem onClick={() => { onDownload(videoId, true); setMenuPos(null); }}>
            ♪ 音声のみダウンロード
          </MenuItem>
        </ContextMenuPopup>
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
