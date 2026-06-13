import type { NgListItem } from '@shared/types';
import { NgListItemType } from '@shared/types';

interface Props {
  ngList: NgListItem[];
  onRemove: (item: NgListItem) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  [NgListItemType.WORD]: 'ワード',
  [NgListItemType.USER_ID]: 'ユーザーID',
  [NgListItemType.COMMAND]: 'コマンド'
};

/**
 * コメント NG 一覧ダイアログ
 */
export function NgListDialog({ ngList, onRemove, onClose }: Props): JSX.Element {
  const words = ngList.filter((x) => x.type === NgListItemType.WORD);
  const users = ngList.filter((x) => x.type === NgListItemType.USER_ID);
  const cmds = ngList.filter((x) => x.type === NgListItemType.COMMAND);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-nndd-panel border border-nndd-border rounded shadow-lg w-[480px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-nndd-border shrink-0">
          <span className="text-sm font-bold">コメント NG 一覧</span>
          <button
            onClick={onClose}
            className="text-nndd-subtext hover:text-nndd-text text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* 内容 */}
        <div className="overflow-auto flex-1 p-3 space-y-3">
          {ngList.length === 0 && (
            <p className="text-xs text-nndd-subtext text-center py-4">NG 項目なし</p>
          )}

          {[
            { label: 'NGワード', items: words },
            { label: 'NGユーザーID', items: users },
            { label: 'NGコマンド', items: cmds }
          ].map(({ label, items }) =>
            items.length === 0 ? null : (
              <div key={label}>
                <div className="text-xs text-nndd-subtext font-bold mb-1">{label} ({items.length})</div>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <div
                      key={`${item.type}-${item.value}`}
                      className="flex items-center gap-2 px-2 py-1 bg-nndd-bg rounded hover:bg-nndd-border/50 group"
                    >
                      <span className="flex-1 text-xs break-all">{item.value}</span>
                      <button
                        onClick={() => onRemove(item)}
                        className="text-xs text-nndd-subtext hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="削除"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {/* フッター */}
        <div className="px-4 py-2 border-t border-nndd-border text-xs text-nndd-subtext shrink-0">
          合計 {ngList.length} 件 — 右クリックで NG 追加
        </div>
      </div>
    </div>
  );
}
