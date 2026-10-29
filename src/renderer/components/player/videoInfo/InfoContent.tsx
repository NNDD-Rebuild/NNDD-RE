import { useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import type { WatchPageInfo } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { tagDictionaryUrl, userUrl, watchUrl } from '@shared/utils/nicoUrl';
import { ContextMenuPopup, MenuItem } from '../../common/VideoCard';
import { descriptionLinkUrl, openDescriptionUrl, sanitizeDescription } from './description';

interface CopyMenu {
  x: number;
  y: number;
  items: { label: string; text?: string; onClick?: () => void }[];
}

/** 動画情報タブ: タイトル・投稿者・チャンネル・タグ・説明文 */
export function InfoContent({ watch, ichibaHtmlPath }: { watch: WatchPageInfo | null; ichibaHtmlPath?: string }): JSX.Element {
  const [openVideoLinkInPlayer] = useConfig<boolean>('player.openVideoLinkInPlayer', false);
  const [ctxMenu, setCtxMenu] = useState<CopyMenu | null>(null);

  if (!watch) {
    return (
      <div className="p-4 text-nndd-subtext text-sm">
        動画情報を読み込み中…
      </div>
    );
  }

  const handleDescClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const url = descriptionLinkUrl(e);
    if (url) {
      e.preventDefault();
      openDescriptionUrl(url, openVideoLinkInPlayer);
    }
  };

  const nicoUrl = watchUrl(watch.videoId);

  const openCopyMenu = (e: React.MouseEvent, items: CopyMenu['items']): void => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="overflow-auto h-full p-3 text-sm text-nndd-text">
      <h1
        className="text-base font-bold mb-1"
        onContextMenu={(e) => openCopyMenu(e, [{ label: '📋 タイトルをコピー', text: watch.title }])}
      >
        {watch.title}
      </h1>
      <div className="text-xs text-nndd-subtext mb-1">
        投稿: {watch.registeredAt} ・ 再生 {watch.count.view.toLocaleString()} ・
        コメ {watch.count.comment.toLocaleString()} ・ マイリス{' '}
        {watch.count.mylist.toLocaleString()} ・ いいね{' '}
        {watch.count.like.toLocaleString()}
      </div>
      <div className="text-xs mb-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, nicoUrl)}
          className="text-nndd-accent underline hover:opacity-80"
          title={nicoUrl}
          onContextMenu={(e) => openCopyMenu(e, [
            { label: '📋 動画IDをコピー', text: watch.videoId },
            { label: '📋 動画URLをコピー', text: nicoUrl }
          ])}
        >
          {watch.videoId} →ニコニコで見る
        </button>
        {ichibaHtmlPath && (
          <button
            onClick={() => window.nndd.invoke(window.nndd.channels.SYS_OPEN_IN_BROWSER, ichibaHtmlPath)}
            className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
            title="ニコニコ市場情報を開く (旧NNDD互換ファイル)"
          >
            🛒 市場
          </button>
        )}
      </div>

      {watch.owner && (
        <div className="flex items-center gap-2 mb-3">
          {watch.owner.iconUrl && (
            <img
              src={watch.owner.iconUrl}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // キャッシュが失われた場合などに非表示
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <button
            onClick={() =>
              window.nndd.invoke(IpcChannel.NAV_FOLLOW_USER, {
                userId: String(watch.owner!.id),
                nickname: watch.owner!.nickname,
                iconUrl: watch.owner!.iconUrl
              })
            }
            onContextMenu={(e) => {
              openCopyMenu(e, [
                { label: '📋 ユーザー名をコピー', text: watch.owner!.nickname },
                { label: '📋 ユーザーIDをコピー', text: String(watch.owner!.id) },
                {
                  label: '🌐 ユーザーページを開く',
                  onClick: () =>
                    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, userUrl(watch.owner!.id))
                }
              ]);
            }}
            className="text-sm hover:text-nndd-accent hover:underline"
            title="クリック: フォロー中タブでこの投稿者の動画を表示 (右クリックでメニュー)"
          >
            {watch.owner.nickname}
          </button>
        </div>
      )}

      {watch.channel && (
        <div className="mb-3 text-xs">
          📺 {watch.channel.name}{' '}
          {watch.channel.isOfficialAnime && (
            <span className="text-nndd-accent ml-1">公式</span>
          )}
        </div>
      )}

      {watch.tags.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-1">タグ (ダブルクリックで検索 / 右クリックで大百科)</div>
          <div className="flex flex-wrap gap-1">
            {watch.tags.map((t) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- ダブルクリック専用の補助操作で、キーボード操作の追加は挙動変更になるため
              <span
                key={t}
                className="px-2 py-0.5 bg-nndd-border rounded text-xs cursor-pointer hover:bg-nndd-accent hover:text-white transition-colors"
                onDoubleClick={() => window.nndd.invoke(IpcChannel.NAV_SEARCH_TAG, t)}
                onContextMenu={(e) =>
                  openCopyMenu(e, [
                    {
                      label: '📖 ニコニコ大百科で開く',
                      onClick: () => window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, tagDictionaryUrl(t))
                    },
                    { label: '📋 タグをコピー', text: t }
                  ])
                }
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <div className="text-xs text-nndd-subtext mb-1">説明</div>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 説明文内リンクのクリックを委譲で拾うためのハンドラで、リンク自体はキーボード操作可能 */}
        <div
          className="text-sm leading-relaxed break-words whitespace-pre-wrap"
          dangerouslySetInnerHTML={{
            __html: sanitizeDescription(watch.description)
          }}
          onClick={handleDescClick}
          onContextMenu={(e) => {
            const text = e.currentTarget.innerText;
            openCopyMenu(e, [{ label: '📋 説明文をコピー', text }]);
          }}
        />
      </div>
      {ctxMenu && (
        <ContextMenuPopup x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          {ctxMenu.items.map((it) => (
            <MenuItem
              key={it.label}
              onClick={() => {
                if (it.text !== undefined) void navigator.clipboard.writeText(it.text);
                it.onClick?.();
                setCtxMenu(null);
              }}
            >
              {it.label}
            </MenuItem>
          ))}
        </ContextMenuPopup>
      )}
    </div>
  );
}
