import { useState, useCallback } from 'react';
import type { NgListItem, NgListItemTypeValue } from '@shared/types';
import { NgListItemType } from '@shared/types';

interface Props {
  ngList: NgListItem[];
  onAdd: (item: NgListItem) => void;
  onRemove: (item: NgListItem) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  [NgListItemType.WORD]: 'ワード',
  [NgListItemType.USER_ID]: 'ユーザーID',
  [NgListItemType.COMMAND]: 'コマンド'
};

const TYPE_OPTIONS: { type: NgListItemTypeValue; label: string; placeholder: string }[] = [
  { type: NgListItemType.WORD, label: 'ワード', placeholder: 'NGワードを入力' },
  { type: NgListItemType.USER_ID, label: 'ユーザーID', placeholder: 'ユーザーIDを入力' },
  { type: NgListItemType.COMMAND, label: 'コマンド', placeholder: 'コマンドを入力 (例: big)' }
];

/**
 * コメント NG 一覧ダイアログ
 */
export function NgListDialog({ ngList, onAdd, onRemove, onClose }: Props): JSX.Element {
  const [addType, setAddType] = useState<NgListItemTypeValue>(NgListItemType.WORD);
  const [addValue, setAddValue] = useState('');

  const handleAdd = useCallback((): void => {
    const v = addValue.trim();
    if (!v) return;
    onAdd({ type: addType, value: v });
    setAddValue('');
  }, [addType, addValue, onAdd]);

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

        {/* 追加フォーム */}
        <div className="px-4 py-2 border-t border-nndd-border shrink-0 space-y-1">
          <div className="flex gap-1">
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value as NgListItemTypeValue)}
              className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 shrink-0"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.type} value={o.type}>{o.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder={TYPE_OPTIONS.find((o) => o.type === addType)?.placeholder}
              className="flex-1 text-xs bg-nndd-bg border border-nndd-border rounded px-2 py-0.5 min-w-0"
            />
            <button
              onClick={handleAdd}
              className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 shrink-0"
            >
              追加
            </button>
          </div>
          <div className="text-xs text-nndd-subtext">
            合計 {ngList.length} 件 — 右クリックでも NG 追加可
          </div>
        </div>
      </div>
    </div>
  );
}
