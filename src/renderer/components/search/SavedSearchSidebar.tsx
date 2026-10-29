import { useMemo, useState } from 'react';
import type { SearchItem, NNDDRESearchSortTypeValue, NNDDRESearchTypeValue } from '@shared/types';
import { NNDDRESearchSortType, NNDDRESearchType } from '@shared/types';
import { SEARCH_SORT_OPTIONS, SEARCH_TYPE_OPTIONS } from './searchOptions';

/**
 * 保存した検索の一覧 (左ペイン)。フォルダ分け・ドラッグ&ドロップでの移動・編集ができる。
 * 元: 本家の検索条件ツリー (SearchItemManager / SearchItemEdit)
 */
export function SavedSearchSidebar({
  items,
  onLoad,
  onLoadAndSearch,
  onChanged
}: {
  items: SearchItem[];
  onLoad: (s: SearchItem) => void;
  onLoadAndSearch: (s: SearchItem) => void;
  /** 追加・編集・移動・削除のあとに一覧を読み直してもらう */
  onChanged: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SearchItem | null>(null);

  const children = useMemo(() => {
    const ids = new Set(items.map((s) => s.id));
    const map = new Map<string | null, SearchItem[]>();
    for (const s of items) {
      // 親フォルダが見つからない項目はルートに出す (親だけ消えた場合の取りこぼし防止)
      const key = s.parentId && ids.has(s.parentId) ? s.parentId : null;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCreateFolder = async (): Promise<void> => {
    const folder: SearchItem = {
      id: crypto.randomUUID(),
      name: '新しいフォルダ',
      word: '',
      type: NNDDRESearchType.KEYWORD,
      sortType: NNDDRESearchSortType.REGISTERED_AT_DESC,
      parentId: null,
      isDir: true
    };
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_ADD, folder);
    onChanged();
    setEditing(folder);
  };

  const handleMove = async (id: string, parentId: string | null): Promise<void> => {
    setDragId(null);
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_MOVE, { id, parentId });
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    onChanged();
  };

  const handleRemove = async (s: SearchItem): Promise<void> => {
    if (s.isDir && (children.get(s.id)?.length ?? 0) > 0) {
      if (!window.confirm(`フォルダ「${s.name}」と、中の保存検索をすべて削除します。よろしいですか？`)) return;
    }
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_REMOVE, s.id);
    onChanged();
  };

  const handleSaveEdit = async (next: SearchItem): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.SEARCH_SAVED_ADD, next);
    setEditing(null);
    onChanged();
  };

  const renderRows = (parentId: string | null, depth: number): JSX.Element[] =>
    (children.get(parentId) ?? []).flatMap((s) => {
      const open = expanded.has(s.id);
      const row = (
        <div
          key={s.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            setDragId(s.id);
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={s.isDir && dragId ? (e) => e.preventDefault() : undefined}
          onDrop={
            s.isDir && dragId
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleMove(dragId, s.id);
                }
              : undefined
          }
          style={depth > 0 ? { paddingLeft: 4 + depth * 14 } : undefined}
          className="group flex items-center gap-1 p-1 hover:bg-nndd-border rounded text-xs"
        >
          {s.isDir ? (
            <button
              onClick={() => toggle(s.id)}
              className="flex-1 text-left truncate"
              title={s.name}
            >
              <span className="inline-block w-3 text-nndd-subtext">{open ? '▼' : '▶'}</span>
              📁 {s.name}
            </button>
          ) : (
            <button
              onClick={() => onLoad(s)}
              onDoubleClick={() => onLoadAndSearch(s)}
              className="flex-1 text-left truncate"
              title={s.word}
            >
              {s.name}
            </button>
          )}
          <button
            onClick={() => setEditing(s)}
            className="text-nndd-subtext hover:text-nndd-text opacity-0 group-hover:opacity-100"
            title="編集"
          >
            ✎
          </button>
          <button
            onClick={() => void handleRemove(s)}
            className="text-nndd-subtext hover:text-red-500 dark:hover:text-red-400"
            title="削除"
          >
            ×
          </button>
        </div>
      );
      return s.isDir && open ? [row, ...renderRows(s.id, depth + 1)] : [row];
    });

  return (
    <aside
      className="w-56 border-r border-nndd-border bg-nndd-panel p-2 overflow-y-auto"
      onDragOver={dragId ? (e) => e.preventDefault() : undefined}
      onDrop={dragId ? (e) => { e.preventDefault(); void handleMove(dragId, null); } : undefined}
    >
      <div className="flex items-center mb-2">
        <span className="font-bold text-xs text-nndd-subtext flex-1">保存した検索</span>
        <button
          onClick={() => void handleCreateFolder()}
          className="text-xs text-nndd-subtext hover:text-nndd-text px-1"
          title="フォルダを作る (ドラッグで保存検索を入れられます)"
        >
          📁＋
        </button>
      </div>
      {items.length === 0 ? <div className="text-xs text-nndd-subtext">なし</div> : renderRows(null, 0)}
      {editing && (
        <EditDialog item={editing} onCancel={() => setEditing(null)} onSave={(n) => void handleSaveEdit(n)} />
      )}
    </aside>
  );
}

function EditDialog({
  item,
  onCancel,
  onSave
}: {
  item: SearchItem;
  onCancel: () => void;
  onSave: (item: SearchItem) => void;
}): JSX.Element {
  const [name, setName] = useState(item.name);
  const [word, setWord] = useState(item.word);
  const [type, setType] = useState<NNDDRESearchTypeValue>(item.type);
  const [sortType, setSortType] = useState<NNDDRESearchSortTypeValue>(item.sortType);
  const isDir = !!item.isDir;
  const valid = name.trim() !== '' && (isDir || word.trim() !== '');
  const inputCls = 'flex-1 min-w-0 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-nndd-panel border border-nndd-border rounded shadow-lg w-96 p-4 space-y-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold">{isDir ? 'フォルダ名の変更' : '保存した検索を編集'}</div>
        <label className="flex items-center gap-2">
          <span className="w-12 shrink-0">名前</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        {!isDir && (
          <>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0">検索語</span>
              <input value={word} onChange={(e) => setWord(e.target.value)} className={inputCls} />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0">種別</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as NNDDRESearchTypeValue)}
                className={inputCls}
              >
                {SEARCH_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0">並び順</span>
              <select
                value={sortType}
                onChange={(e) => setSortType(e.target.value as NNDDRESearchSortTypeValue)}
                className={inputCls}
              >
                {SEARCH_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-3 py-1 bg-nndd-border rounded hover:opacity-80">
            キャンセル
          </button>
          <button
            disabled={!valid}
            onClick={() => onSave({ ...item, name: name.trim(), word: word.trim(), type, sortType })}
            className="px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
