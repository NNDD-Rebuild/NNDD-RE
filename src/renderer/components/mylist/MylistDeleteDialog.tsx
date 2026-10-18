import type { MyList } from '@shared/types';

/**
 * 左ペインの「×」を押したときの確認ダイアログ。
 *  - フォルダ: 中身はルートへ移ることを伝えて確認
 *  - 他人のマイリスト・チャンネル等: RE の登録を外す確認
 *  - 自分のマイリスト: RE の登録だけ外すか、ニコニコのマイリストごと削除するか (後者は取り消せない)
 */
export function MylistDeleteDialog({
  mylist,
  isOwn,
  busy,
  onCancel,
  onRemoveLocal,
  onDeleteServer
}: {
  mylist: MyList;
  isOwn: boolean;
  busy: boolean;
  onCancel: () => void;
  onRemoveLocal: () => void;
  onDeleteServer: () => void;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-nndd-panel border border-nndd-border rounded shadow-lg p-4 w-[420px] max-w-[90vw] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold break-words">
          {mylist.isDir ? 'フォルダ' : 'マイリスト'}「{mylist.myListName}」を削除しますか?
        </div>

        {mylist.isDir && (
          <div className="text-xs text-nndd-subtext">
            フォルダの中のマイリストは削除されず、一覧の最上位に移ります。
          </div>
        )}
        {!mylist.isDir && !isOwn && (
          <div className="text-xs text-nndd-subtext">
            このアプリの登録を外します。ニコニコ上のマイリストは変わりません。
          </div>
        )}
        {!mylist.isDir && isOwn && (
          <div className="text-xs space-y-1">
            <div className="text-nndd-subtext">これはあなたのニコニコのマイリストです。</div>
            <div className="text-nndd-subtext">
              「登録だけ外す」: このアプリの一覧から外します。ニコニコ上のマイリストは残ります。
            </div>
            <div className="text-red-500 dark:text-red-400">
              「ニコニコからも削除」: ニコニコ上のマイリストと、中の動画の登録を消します。取り消せません。
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
            {mylist.isDir ? '削除' : isOwn ? '登録だけ外す' : '登録を外す'}
          </button>
          {!mylist.isDir && isOwn && (
            <button
              onClick={onDeleteServer}
              disabled={busy}
              className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:opacity-80 disabled:opacity-50"
            >
              {busy ? '削除中…' : 'ニコニコからも削除'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
