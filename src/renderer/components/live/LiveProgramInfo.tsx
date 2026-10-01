import { useState } from 'react';
import type { LiveCommentLock, LiveProgramInfo as LiveProgramInfoData, LiveStatistics } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { liveWatchUrl } from '@shared/utils/nicoUrl';
import { useConfig } from '../../hooks/useConfig';
import { descriptionLinkUrl, openDescriptionUrl, sanitizeDescription } from '../player/VideoInfoView';
import { ContextMenuPopup, MenuItem } from '../common/VideoCard';
import { commentLockText } from './LiveOverlays';

/** サイドパネル「番組情報」タブ (通常プレイヤーの「動画情報」タブと同じ構成) */
export function LiveProgramInfo({
  program,
  stateLabel,
  elapsed,
  remaining,
  statistics,
  programId,
  commentLock
}: {
  program: LiveProgramInfoData | null;
  stateLabel: string;
  elapsed: string;
  remaining: string;
  statistics: LiveStatistics | null;
  programId: string;
  commentLock: LiveCommentLock | null;
}): JSX.Element {
  const [openVideoLinkInPlayer] = useConfig<boolean>('player.openVideoLinkInPlayer', false);
  const [ownerCtxMenu, setOwnerCtxMenu] = useState<{ x: number; y: number } | null>(null);

  if (!program) {
    return <div className="p-4 text-nndd-subtext text-sm">番組情報を読み込み中…</div>;
  }

  const begin = program.beginTimeMs ? new Date(program.beginTimeMs) : null;
  const end = program.endTimeMs ? new Date(program.endTimeMs) : null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const liveUrl = liveWatchUrl(program.programId || programId);
  const supplier = program.supplier;
  const isUser = supplier?.type === 'user' && Boolean(supplier.id);
  // コメントサーバーから届いた最新値を優先し、届くまでは視聴ページ取得時点の値
  const tsReservations = statistics?.timeshiftReservations ?? program.timeshiftReservationCount;
  const lockText = commentLockText(commentLock);

  const handleDescClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const url = descriptionLinkUrl(e);
    if (!url) return;
    e.preventDefault();
    // 生放送の番組リンクは生放送プレイヤーで開く
    const lv = url.match(/live\d*\.nicovideo\.jp\/watch\/(lv\d+)/);
    if (lv) void window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, lv[1]);
    else openDescriptionUrl(url, openVideoLinkInPlayer);
  };

  return (
    <div className="overflow-auto h-full p-3 text-sm text-nndd-text">
      <h1 className="text-base font-bold mb-1">{program.title}</h1>
      <div className="text-xs text-nndd-subtext mb-1">
        <span className="px-1.5 py-0.5 mr-1 rounded bg-nndd-accent text-white font-bold">{stateLabel}</span>
        {begin && `開始: ${begin.getFullYear()}/${pad(begin.getMonth() + 1)}/${pad(begin.getDate())} ${pad(begin.getHours())}:${pad(begin.getMinutes())}`}
        {elapsed && ` ・ 経過 ${elapsed}`}
        {end && remaining && ` ・ 終了予定 ${pad(end.getHours())}:${pad(end.getMinutes())} (あと ${remaining})`}
        {statistics && ` ・ 来場 ${statistics.viewers.toLocaleString()} ・ コメ ${statistics.comments.toLocaleString()}`}
        {tsReservations !== undefined && ` ・ TS予約 ${tsReservations.toLocaleString()}`}
      </div>
      {lockText && <div className="text-xs text-nndd-subtext mb-1">🔒 {lockText}</div>}
      <div className="text-xs mb-3">
        <button
          onClick={() => window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, liveUrl)}
          className="text-nndd-accent underline hover:opacity-80"
          title={liveUrl}
        >
          {program.programId || programId} →ニコニコ生放送で見る
        </button>
      </div>

      {supplier && (
        <div className="flex items-center gap-2 mb-3">
          {supplier.iconUrl && (
            <img
              src={supplier.iconUrl}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <button
            onClick={() => {
              if (isUser) {
                void window.nndd.invoke(IpcChannel.NAV_FOLLOW_USER, {
                  userId: supplier.id,
                  nickname: supplier.name,
                  iconUrl: supplier.iconUrl
                });
              } else if (supplier.pageUrl) {
                void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, supplier.pageUrl);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (supplier.pageUrl) setOwnerCtxMenu({ x: e.clientX, y: e.clientY });
            }}
            className="text-sm hover:text-nndd-accent hover:underline text-left"
            title={
              isUser
                ? 'クリック: フォロー中タブでこの放送者の動画を表示 (右クリックでメニュー)'
                : 'クリック: ページを開く'
            }
          >
            {supplier.name}
          </button>
          {supplier.level !== undefined && (
            <span className="text-xs text-nndd-subtext">Lv.{supplier.level}</span>
          )}
          {ownerCtxMenu && (
            <ContextMenuPopup x={ownerCtxMenu.x} y={ownerCtxMenu.y} onClose={() => setOwnerCtxMenu(null)}>
              <MenuItem
                onClick={() => {
                  void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, supplier.pageUrl);
                  setOwnerCtxMenu(null);
                }}
              >
                🌐 {isUser ? 'ユーザーページを開く' : 'ページを開く'}
              </MenuItem>
            </ContextMenuPopup>
          )}
        </div>
      )}

      {program.tags.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-1">タグ (ダブルクリックで生放送を検索)</div>
          <div className="flex flex-wrap gap-1">
            {program.tags.map((t) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <span
                key={t}
                className="px-2 py-0.5 bg-nndd-border rounded text-xs cursor-pointer hover:bg-nndd-accent hover:text-white transition-colors"
                onDoubleClick={() => window.nndd.invoke(IpcChannel.NAV_LIVE_SEARCH, t)}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {program.description && (
        <div className="mt-2">
          <div className="text-xs text-nndd-subtext mb-1">説明</div>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="text-sm leading-relaxed break-words whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeDescription(program.description) }}
            onClick={handleDescClick}
          />
        </div>
      )}
    </div>
  );
}
