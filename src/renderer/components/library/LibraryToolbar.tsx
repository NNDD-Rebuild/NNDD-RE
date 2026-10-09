import type { LibraryScanProgress } from '@shared/types';
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
  scanProgress,
  onScan,
  onScanCancel
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
  scanProgress: LibraryScanProgress | null;
  /** full=true: 変更の有無に関わらず全件読み直す (Shift+クリック) */
  onScan: (full: boolean) => void;
  onScanCancel: () => void;
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
      {scanning && (
        <span className="text-xs text-nndd-subtext whitespace-nowrap">{scanLabel(scanProgress)}</span>
      )}
      {scanning && (
        <button
          onClick={onScanCancel}
          className="text-xs px-2 py-1 bg-nndd-border rounded hover:opacity-80"
        >
          中断
        </button>
      )}
      <button
        onClick={(e) => onScan(e.shiftKey)}
        disabled={scanning}
        title="前回から変わっていない動画は読み込みを省略します。Shift+クリックで全件を読み直します"
        className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
      >
        {scanning ? 'スキャン中…' : 'ライブラリを更新'}
      </button>
    </div>
  );
}

function scanLabel(p: LibraryScanProgress | null): string {
  if (!p) return 'フォルダを確認中…';
  if (p.phase === 'walk') return `フォルダを走査中… 動画 ${p.current} 件`;
  if (p.phase === 'register') return `登録中 ${p.current} / ${p.total}`;
  return '削除された動画を確認中…';
}
