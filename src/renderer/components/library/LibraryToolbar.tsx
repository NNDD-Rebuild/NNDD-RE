import { ContinuousPlayButton } from '../common/ContinuousPlayButton';
import type { LibraryDisplayMode } from './libraryUtils';

/** 右ペイン (ローカルライブラリ) 上部のツールバー */
export function LibraryToolbar({
  searchText,
  onSearchTextChange,
  favoriteOnly,
  onToggleFavoriteOnly,
  filteredCount,
  moving,
  selectedCount,
  moveError,
  displayMode,
  onToggleDisplayMode,
  continuousPlayDisabled,
  onContinuousPlay,
  scanning,
  onScan
}: {
  searchText: string;
  onSearchTextChange: (v: string) => void;
  favoriteOnly: boolean;
  onToggleFavoriteOnly: () => void;
  filteredCount: number;
  moving: boolean;
  selectedCount: number;
  moveError: string | null;
  displayMode: LibraryDisplayMode;
  onToggleDisplayMode: () => void;
  continuousPlayDisabled: boolean;
  onContinuousPlay: (audioOnly: boolean) => void;
  scanning: boolean;
  onScan: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
      <input
        value={searchText}
        onChange={(e) => onSearchTextChange(e.target.value)}
        placeholder="タイトル・説明文・タグで絞り込み"
        className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
      />
      <button
        onClick={() => onToggleFavoriteOnly()}
        title="お気に入りのみ表示"
        className={[
          'text-xs px-2 py-1 rounded',
          favoriteOnly ? 'bg-yellow-500 text-black' : 'bg-nndd-border hover:opacity-80'
        ].join(' ')}
      >
        ★ お気に入りのみ
      </button>
      <span className="text-xs text-nndd-subtext">{filteredCount} 件</span>
      {moving && (
        <span className="text-xs text-nndd-accent animate-pulse">移動中…</span>
      )}
      {!moving && selectedCount > 0 && (
        <span className="text-xs text-nndd-accent font-bold">
          {selectedCount} 件選択中 (フォルダへドロップで移動)
        </span>
      )}
      {moveError && (
        <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-xs" title={moveError}>
          ⚠ {moveError}
        </span>
      )}
      <button
        onClick={() => onToggleDisplayMode()}
        title={displayMode === 'table' ? 'グリッド表示に切り替え' : 'リスト表示に切り替え'}
        className="text-xs px-2 py-1 bg-nndd-border rounded hover:opacity-80"
      >
        {displayMode === 'table' ? '⊞' : '☰'}
      </button>
      <ContinuousPlayButton
        disabled={continuousPlayDisabled}
        onPlay={onContinuousPlay}
      />
      <button
        onClick={onScan}
        disabled={scanning}
        className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
      >
        {scanning ? 'スキャン中…' : 'ライブラリを更新'}
      </button>
    </div>
  );
}
