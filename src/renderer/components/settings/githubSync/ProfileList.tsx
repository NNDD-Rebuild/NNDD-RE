import { useState } from 'react';
import type { SyncProfile } from '@shared/types';
import { Btn, Hint, TextInput } from '../common';

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
      <div className="text-sm font-bold">同期プロファイル</div>

      {profiles.length === 0 && !adding && (
        <Hint>プロファイル未登録</Hint>
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
            <Btn
              variant="danger"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(p.id);
              }}
              className="shrink-0 ml-2"
            >
              削除
            </Btn>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="flex gap-2">
          <TextInput
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="プロファイル名 (例: 仕事用)"
            className="flex-1"
          />
          <Btn variant="primary" onClick={handleAdd}>
            追加
          </Btn>
          <Btn onClick={() => setAdding(false)}>キャンセル</Btn>
        </div>
      ) : (
        <Btn onClick={() => setAdding(true)}>+ 新規プロファイル</Btn>
      )}
    </div>
  );
}
