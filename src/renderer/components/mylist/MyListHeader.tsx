import type { RefObject } from 'react';
import type { Selected } from './mylistUtils';

/**
 * 右ペインのヘッダー: リスト名 / URL コピー / 選択解除 / 一時表示リストの登録 /
 * 一括 DL (▼ メニュー付き) / グリッド・リスト切替。
 * 一括 DL メニューの開閉状態は親が保持する (ヘッダーのアンマウントで状態が消えないように)。
 */
export function MyListHeader({
  selected,
  selectedCount,
  onClearSelection,
  showAddCurrent,
  onAddCurrent,
  bulkMenuRef,
  bulkMenuOpen,
  setBulkMenuOpen,
  bulkDling,
  bulkDisabled,
  bulkLabel,
  onBulkDownload,
  displayMode,
  onDisplayModeChange,
  showToast
}: {
  selected: Selected;
  selectedCount: number;
  onClearSelection: () => void;
  showAddCurrent: boolean;
  onAddCurrent: () => void;
  bulkMenuRef: RefObject<HTMLDivElement>;
  bulkMenuOpen: boolean;
  setBulkMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  bulkDling: boolean;
  bulkDisabled: boolean;
  bulkLabel: string;
  onBulkDownload: (subDir?: string) => Promise<void>;
  displayMode: 'grid' | 'list';
  onDisplayModeChange: (mode: 'grid' | 'list') => void;
  showToast: (msg: string) => void;
}): JSX.Element {
  return (
    <div className="shrink-0 p-2 border-b border-nndd-border bg-nndd-panel flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate">
          {selected.kind === 'mylist' ? selected.mylist.myListName : selected.playlist.name}
        </div>
        {selected.kind === 'mylist' && (
          <div
            className="text-xs text-nndd-subtext truncate cursor-pointer hover:underline"
            title="クリックでURLをコピー"
            onClick={() => {
              navigator.clipboard.writeText(selected.mylist.myListUrl);
              showToast('URLをコピーしました');
            }}
          >
            {selected.mylist.myListUrl}
          </div>
        )}
      </div>
      {selectedCount > 0 && (
        <button
          onClick={() => onClearSelection()}
          className="text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
        >
          選択解除
        </button>
      )}
      {showAddCurrent && (
        <button
          onClick={onAddCurrent}
          className="text-xs px-3 py-1 bg-green-700 text-white rounded hover:opacity-80 shrink-0"
          title="このマイリストを登録リストに追加"
        >
          マイリスト追加
        </button>
      )}
      <div ref={bulkMenuRef} className="relative inline-flex shrink-0">
        <button
          onClick={() => onBulkDownload()}
          disabled={bulkDling || bulkDisabled}
          className="text-xs px-3 py-1 bg-nndd-accent text-white rounded-l hover:opacity-80 disabled:opacity-50"
          title="Shift+クリックで範囲選択 / Ctrl+クリックで複数選択"
        >
          {bulkDling ? '追加中…' : bulkLabel}
        </button>
        <button
          onClick={() => setBulkMenuOpen((v) => !v)}
          disabled={bulkDling || bulkDisabled}
          className="text-xs px-1 py-1 bg-nndd-accent text-white rounded-r border-l border-white/30 hover:opacity-80 disabled:opacity-50"
        >▼</button>
        {bulkMenuOpen && (
          <div className="absolute top-full right-0 mt-0.5 flex flex-col bg-nndd-panel border border-nndd-border rounded shadow-lg z-50 text-xs whitespace-nowrap">
            <button
              onClick={() => { setBulkMenuOpen(false); void onBulkDownload(); }}
              className="block w-full px-3 py-1 text-left hover:bg-nndd-border"
            >通常DL</button>
            <button
              onClick={() => {
                setBulkMenuOpen(false);
                const name = selected?.kind === 'mylist' ? selected.mylist.myListName : selected?.kind === 'playlist' ? selected.playlist.name : undefined;
                void onBulkDownload(name);
              }}
              className="block w-full px-3 py-1 text-left hover:bg-nndd-border"
            >フォルダ作成してDL</button>
          </div>
        )}
      </div>
      <div className="flex border border-nndd-border rounded overflow-hidden shrink-0">
        <button
          onClick={() => onDisplayModeChange('grid')}
          className={`text-xs px-2 py-1 ${displayMode === 'grid' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
          title="グリッド表示"
        >⊞</button>
        <button
          onClick={() => onDisplayModeChange('list')}
          className={`text-xs px-2 py-1 ${displayMode === 'list' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
          title="リスト表示"
        >☰</button>
      </div>
    </div>
  );
}
