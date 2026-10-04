import type { MyList } from '@shared/types';

/** アカウントから取得したマイリスト一覧 (登録済み判定・個別追加・全追加) */
export function AccountMylistPanel({
  accountMylists,
  registeredIds,
  importingIds,
  onImportAll,
  onClose,
  onImportOne
}: {
  accountMylists: MyList[];
  registeredIds: Set<string>;
  importingIds: Set<string>;
  onImportAll: () => void;
  onClose: () => void;
  onImportOne: (ml: MyList) => void;
}): JSX.Element {
  return (
    <div className="shrink-0 border-b border-nndd-border bg-nndd-bg">
      <div className="flex items-center justify-between px-2 py-1 bg-nndd-panel">
        <span className="text-xs font-bold text-nndd-subtext">
          アカウントのマイリスト ({accountMylists.length})
        </span>
        <div className="flex gap-1">
          <button
            onClick={onImportAll}
            className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80"
            title="未登録のマイリストをすべて追加"
          >
            全追加
          </button>
          <button
            onClick={() => onClose()}
            className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-red-400 hover:text-white"
          >
            ×
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {accountMylists.length === 0 ? (
          <div className="text-xs text-nndd-subtext p-2">マイリストが見つかりません</div>
        ) : (
          accountMylists.map((ml) => {
            const registered = registeredIds.has(ml.myListUrl);
            const importing = importingIds.has(ml.myListUrl);
            return (
              <div
                key={ml.myListUrl}
                className="flex items-center gap-1 px-2 py-1 text-xs border-b border-nndd-border"
              >
                <span className="flex-1 truncate" title={ml.myListUrl}>{ml.myListName}</span>
                {registered ? (
                  <span className="text-nndd-subtext shrink-0">登録済</span>
                ) : (
                  <button
                    onClick={() => onImportOne(ml)}
                    disabled={importing}
                    className="shrink-0 text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
                  >
                    {importing ? '追加中' : '追加'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
