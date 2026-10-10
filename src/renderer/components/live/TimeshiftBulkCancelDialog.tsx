import { useState } from 'react';

export interface BulkCancelItem {
  programId: string;
  title: string;
  /** 解除対象になった理由 (視聴期限が切れました 等) */
  reason: string;
}

interface Props {
  items: BulkCancelItem[];
  busy: boolean;
  onConfirm: (programIds: string[]) => void;
  onCancel: () => void;
}

/**
 * もう視聴できないタイムシフト予約をまとめて解除する前の確認ダイアログ。
 * 一覧のチェックを外した番組は解除しない
 */
export function TimeshiftBulkCancelDialog({ items, busy, onConfirm, onCancel }: Props): JSX.Element {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.map((i) => i.programId)));
  const allChecked = checked.size === items.length;

  const toggle = (id: string): void =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-nndd-panel border border-nndd-border rounded shadow-lg w-[560px] max-w-[90vw] p-4 space-y-3">
        <div className="text-sm font-semibold">視聴できないタイムシフト予約の解除</div>
        <p className="text-sm">次の {items.length} 件の予約を解除します。よろしいですか？</p>
        <label className="flex items-center gap-2 text-xs text-nndd-subtext cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => setChecked(allChecked ? new Set() : new Set(items.map((i) => i.programId)))}
          />
          すべて選択 ({checked.size} / {items.length})
        </label>
        <div className="max-h-[50vh] overflow-y-auto border border-nndd-border rounded divide-y divide-nndd-border">
          {items.map((it) => (
            <label key={it.programId} className="flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-nndd-border/40">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked.has(it.programId)}
                onChange={() => toggle(it.programId)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate" title={it.title}>
                  {it.title}
                </span>
                <span className="block text-xs text-nndd-subtext">
                  {it.programId} / {it.reason}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1 border border-nndd-border rounded hover:bg-nndd-border/50 disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            キャンセル
          </button>
          <button
            className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:opacity-80 disabled:opacity-50"
            onClick={() => onConfirm(items.filter((i) => checked.has(i.programId)).map((i) => i.programId))}
            disabled={busy || checked.size === 0}
          >
            {busy ? '解除中…' : `${checked.size} 件を解除`}
          </button>
        </div>
      </div>
    </div>
  );
}
