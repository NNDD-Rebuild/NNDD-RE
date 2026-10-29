import { useState } from 'react';
import type { FolderNode } from './folderTree';

/** 左ペインのフォルダツリー 1 ノード (子は再帰的に描画)。動画のドロップ先にもなる */
export function FolderTreeItem({
  node,
  depth,
  selectedFolder,
  dragOverFolder,
  expanded,
  videoCounts,
  onSelect,
  onToggleExpand,
  onDelete,
  onRename,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder
}: {
  node: FolderNode;
  depth: number;
  selectedFolder: string | null;
  dragOverFolder: string | null;
  expanded: Set<string>;
  videoCounts: Map<string, number>;
  onSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onDelete: (path: string) => void;
  /** フォルダ名の変更。失敗したら例外を投げる (呼び出し側でメッセージを出す) */
  onRename: (path: string, newName: string) => Promise<void> | void;
  onDragOverFolder: (path: string, e: React.DragEvent) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (e: React.DragEvent, path: string) => void;
}): JSX.Element {
  const isOpen = expanded.has(node.path);
  const count = videoCounts.get(node.path) ?? 0;
  const hasChildren = node.children.length > 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const commit = (): void => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== node.name) void onRename(node.path, name);
  };
  return (
    <div>
      <div
        className={[
          'flex items-center gap-1 rounded text-xs group',
          selectedFolder === node.path
            ? 'bg-nndd-accent text-white'
            : dragOverFolder === node.path
            ? 'bg-nndd-accent/50 ring-1 ring-nndd-accent'
            : 'hover:bg-nndd-border'
        ].join(' ')}
        style={{ paddingLeft: depth * 12 }}
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/nndd-folder-path', node.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => onDragOverFolder(node.path, e)}
        onDragLeave={onDragLeaveFolder}
        onDrop={(e) => void onDropFolder(e, node.path)}
      >
        <button
          onClick={() => onToggleExpand(node.path)}
          className="shrink-0 w-3 text-center opacity-70"
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : ''}
        </button>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setEditing(false); setDraft(node.name); }
            }}
            className="flex-1 min-w-0 bg-nndd-bg text-nndd-text border border-nndd-accent px-1 py-0 text-xs outline-none"
          />
        ) : (
          <button
            onClick={() => onSelect(node.path)}
            onDoubleClick={() => { setDraft(node.name); setEditing(true); }}
            className="flex-1 text-left px-1 py-0.5 truncate"
            title={`${node.path}\n(ダブルクリックで名前を変更 / ドラッグで別のフォルダへ移動)`}
          >
            {node.name} <span className="text-[10px] opacity-70">({count})</span>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setDraft(node.name); setEditing(true); }}
          className="shrink-0 px-1 py-0.5 opacity-0 group-hover:opacity-100 hover:text-nndd-text transition-opacity"
          title="名前を変更"
        >
          ✎
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
          className="shrink-0 px-1 py-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
          title="フォルダ削除"
        >
          🗑
        </button>
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFolder={selectedFolder}
              dragOverFolder={dragOverFolder}
              expanded={expanded}
              videoCounts={videoCounts}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onDelete={onDelete}
              onRename={onRename}
              onDragOverFolder={onDragOverFolder}
              onDragLeaveFolder={onDragLeaveFolder}
              onDropFolder={onDropFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}
