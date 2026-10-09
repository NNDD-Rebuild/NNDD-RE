import type { FolderNode } from './folderTree';
import { FolderTreeItem } from './FolderTreeItem';
import { LAN_FOLDER } from './libraryUtils';

export function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-2 py-1 text-xs',
        active
          ? 'bg-nndd-bg text-nndd-text border-b-2 border-b-nndd-accent'
          : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text'
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** 左ペイン (タグモード): タグ一覧 (件数の多い順) + 隠したタグ (NGタグ) */
export function LibraryTagList({
  tagStats,
  selectedTag,
  onSelectTag,
  onContextMenuTag,
  hiddenTags,
  onShowTag
}: {
  tagStats: [string, number][];
  selectedTag: string | null;
  onSelectTag: (tag: string) => void;
  onContextMenuTag: (e: React.MouseEvent, tag: string) => void;
  hiddenTags: string[];
  onShowTag: (tag: string) => void;
}): JSX.Element {
  return (
    <>
      {tagStats.length === 0 && (
        <div className="text-xs text-nndd-subtext">タグなし</div>
      )}
      {tagStats.map(([t, n]) => (
        <button
          key={t}
          onClick={() => onSelectTag(t)}
          onContextMenu={(e) => onContextMenuTag(e, t)}
          className={[
            'block w-full text-left px-2 py-0.5 rounded text-xs',
            selectedTag === t
              ? 'bg-nndd-accent text-white'
              : 'hover:bg-nndd-border'
          ].join(' ')}
        >
          {t}{' '}
          <span className="text-nndd-subtext text-[10px]">({n})</span>
        </button>
      ))}
      {hiddenTags.length > 0 && (
        <details className="mt-3 border-t border-nndd-border pt-2">
          <summary className="cursor-pointer text-xs text-nndd-subtext">
            隠したタグ ({hiddenTags.length})
          </summary>
          {hiddenTags.map((t) => (
            <div key={t} className="flex items-center gap-1 px-2 py-0.5 text-xs">
              <span className="flex-1 truncate" title={t}>{t}</span>
              <button
                onClick={() => onShowTag(t)}
                className="shrink-0 text-nndd-accent hover:underline"
              >
                タグを表示
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/** 左ペイン (フォルダモード): 「すべて」 + フォルダツリー + LANライブラリ */
export function LibraryFolderList({
  totalCount,
  selectedFolder,
  onSelectFolder,
  folderTree,
  dragOverFolder,
  expandedFolders,
  folderVideoCounts,
  onToggleExpand,
  onDeleteFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder,
  lanEnabled,
  lanReachable,
  lanLoading,
  lanVideoCount,
  onSelectLan
}: {
  totalCount: number;
  selectedFolder: string | null;
  onSelectFolder: (path: string | null) => void;
  folderTree: FolderNode[];
  dragOverFolder: string | null;
  expandedFolders: Set<string>;
  folderVideoCounts: Map<string, number>;
  onToggleExpand: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onDragOverFolder: (path: string, e: React.DragEvent) => void;
  onDragLeaveFolder: () => void;
  onDropFolder: (e: React.DragEvent, path: string) => void;
  lanEnabled: boolean;
  lanReachable: boolean | null;
  lanLoading: boolean;
  lanVideoCount: number;
  onSelectLan: () => void;
}): JSX.Element {
  const isLanTab = selectedFolder === LAN_FOLDER;
  return (
    <>
      {/* すべて */}
      <button
        onClick={() => onSelectFolder(null)}
        className={[
          'block w-full text-left px-2 py-0.5 rounded text-xs mb-1',
          selectedFolder === null
            ? 'bg-nndd-accent text-white'
            : 'hover:bg-nndd-border'
        ].join(' ')}
      >
        すべて <span className="text-[10px] opacity-70">({totalCount})</span>
      </button>

      {folderTree.length === 0 && (
        <div className="text-xs text-nndd-subtext">フォルダなし</div>
      )}
      {folderTree.map((node) => (
        <FolderTreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedFolder={selectedFolder}
          dragOverFolder={dragOverFolder}
          expanded={expandedFolders}
          videoCounts={folderVideoCounts}
          onSelect={onSelectFolder}
          onToggleExpand={onToggleExpand}
          onDelete={onDeleteFolder}
          onDragOverFolder={onDragOverFolder}
          onDragLeaveFolder={onDragLeaveFolder}
          onDropFolder={onDropFolder}
        />
      ))}

      {/* LANライブラリ */}
      {lanEnabled && (
        <div className="mt-2 pt-2 border-t border-nndd-border">
          <button
            onClick={onSelectLan}
            className={[
              'flex items-center gap-1 w-full text-left px-2 py-0.5 rounded text-xs',
              isLanTab
                ? 'bg-nndd-accent text-white'
                : 'hover:bg-nndd-border'
            ].join(' ')}
          >
            <span>LANライブラリ</span>
            {lanReachable === true && (
              <span className={isLanTab ? 'text-green-200' : 'text-green-400'}>●</span>
            )}
            {lanReachable === false && (
              <span className={isLanTab ? 'text-red-200' : 'text-red-400'}>●</span>
            )}
            {isLanTab && !lanLoading && (
              <span className="text-[10px] opacity-70">({lanVideoCount})</span>
            )}
            {lanLoading && <span className="text-[10px] opacity-70">…</span>}
          </button>
        </div>
      )}
    </>
  );
}

/** 左ペイン下部: フォルダ追加 (入力欄の表示状態・入力値は親が保持) */
export function FolderCreateArea({
  folderCreateError,
  showFolderInput,
  setShowFolderInput,
  newFolderName,
  setNewFolderName,
  onCreate
}: {
  folderCreateError: string | null;
  showFolderInput: boolean;
  setShowFolderInput: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  onCreate: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="shrink-0 border-t border-nndd-border p-2">
      {folderCreateError && (
        <div className="text-xs text-red-500 dark:text-red-400 mb-1 break-all" title={folderCreateError}>
          ⚠ {folderCreateError}
        </div>
      )}
      {showFolderInput ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
              if (e.key === 'Escape') { setShowFolderInput(false); setNewFolderName(''); }
            }}
            placeholder="フォルダ名"
            className="flex-1 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs"
          />
          <button
            onClick={() => void onCreate()}
            disabled={!newFolderName.trim()}
            className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded disabled:opacity-50"
          >
            作成
          </button>
          <button
            onClick={() => { setShowFolderInput(false); setNewFolderName(''); }}
            className="text-xs px-1 py-0.5 bg-nndd-border rounded"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowFolderInput(true)}
          className="w-full text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent/70 text-left"
        >
          + フォルダ追加
        </button>
      )}
    </div>
  );
}
