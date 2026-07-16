import { useState } from 'react';
import type { SyncProfile } from '@shared/types';

export function ProfileList({
  profiles,
  activeProfileId,
  onSelect,
  onAdd,
  onRemove
}: {
  profiles: SyncProfile[];
  activeProfileId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const handleAdd = (): void => {
    const name = newName.trim();
    if (!name) return;
    onAdd(name);
    setNewName('');
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-nndd-text">同期プロファイル</div>

      {profiles.length === 0 && !adding && (
        <div className="text-xs text-nndd-subtext italic">プロファイル未登録</div>
      )}

      <div className="space-y-1">
        {profiles.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={[
              'flex items-center justify-between px-3 py-2 rounded cursor-pointer border',
              p.id === activeProfileId
                ? 'bg-nndd-bg border-nndd-accent'
                : 'border-nndd-border hover:bg-nndd-border/30'
            ].join(' ')}
          >
            <div>
              <div className="text-sm text-nndd-text flex items-center gap-1.5">
                {p.name}
                {p.id === activeProfileId && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nndd-accent text-white">
                    アクティブ
                  </span>
                )}
              </div>
              <div className="text-xs text-nndd-subtext">
                {p.gistId ? 'Gist連携済み' : '未アップロード'}
                {p.lastSyncedAt &&
                  ` ・最終同期: ${new Date(p.lastSyncedAt).toLocaleString('ja-JP')} (${p.lastSyncDirection === 'upload' ? 'アップロード' : 'ダウンロード'})`}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(p.id);
              }}
              className="text-xs text-nndd-subtext hover:text-red-500 shrink-0 ml-2"
            >
              削除
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="flex gap-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="プロファイル名 (例: 仕事用)"
            className="flex-1 px-2 py-1.5 text-xs bg-nndd-bg border border-nndd-border rounded"
          />
          <button
            onClick={handleAdd}
            className="text-xs px-3 py-1.5 bg-nndd-accent text-white rounded hover:opacity-80"
          >
            追加
          </button>
          <button
            onClick={() => setAdding(false)}
            className="text-xs px-3 py-1.5 bg-nndd-border hover:bg-nndd-accent rounded"
          >
            キャンセル
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1.5 bg-nndd-border hover:bg-nndd-accent rounded"
        >
          + 新規プロファイル
        </button>
      )}
    </div>
  );
}
