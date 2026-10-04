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
  onDragOverFolder: (path: string, e: React.DragEvent) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (e: React.DragEvent, path: string) => void;
}): JSX.Element {
  const isOpen = expanded.has(node.path);
  const count = videoCounts.get(node.path) ?? 0;
  const hasChildren = node.children.length > 0;
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
        <button
          onClick={() => onSelect(node.path)}
          className="flex-1 text-left px-1 py-0.5 truncate"
          title={node.path}
        >
          {node.name} <span className="text-[10px] opacity-70">({count})</span>
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
