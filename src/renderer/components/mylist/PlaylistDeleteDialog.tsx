import type { Playlist } from '@shared/types';

/**
 * プレイリストの「×」を押したときの確認ダイアログ。
 *  - ローカルのみ: 削除の確認
 *  - ニコニコと同期中: このアプリのプレイリストだけ消すか、同期先のニコニコのマイリストも消すか (後者は取り消せない)
 */
export function PlaylistDeleteDialog({
  playlist,
  busy,
  onCancel,
  onRemoveLocal,
  onDeleteServer
}: {
  playlist: Playlist;
  busy: boolean;
  onCancel: () => void;
  onRemoveLocal: () => void;
  onDeleteServer: () => void;
}): JSX.Element {
  const synced = !!playlist.serverMylistId;
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-nndd-panel border border-nndd-border rounded shadow-lg p-4 w-[420px] max-w-[90vw] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold break-words">プレイリスト「{playlist.name}」を削除しますか?</div>

        {synced && (
          <div className="text-xs space-y-1">
            <div className="text-nndd-subtext">このプレイリストは、ニコニコのマイリストと同期しています。</div>
            <div className="text-nndd-subtext">
              「プレイリストだけ削除」: このアプリのプレイリストを消します。ニコニコ上のマイリストは残ります。
            </div>
            <div className="text-red-500 dark:text-red-400">
              「ニコニコのマイリストも削除」: 同期先のマイリストと、中の動画の登録も消します。取り消せません。
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 flex-wrap">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-nndd-border rounded hover:opacity-80 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onRemoveLocal}
            disabled={busy}
            className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
          >
            {synced ? 'プレイリストだけ削除' : '削除'}
          </button>
          {synced && (
            <button
              onClick={onDeleteServer}
              disabled={busy}
              className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:opacity-80 disabled:opacity-50"
            >
              {busy ? '削除中…' : 'ニコニコのマイリストも削除'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
