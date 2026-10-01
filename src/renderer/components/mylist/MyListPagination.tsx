import { PAGE_SIZE } from './mylistUtils';

/** ページネーションバー (固定、マイリストのみ) */
export function MyListPagination({
  totalItems,
  currentPage,
  loading,
  onPageChange
}: {
  totalItems: number;
  currentPage: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}): JSX.Element {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
      <span className="text-nndd-subtext">
        {totalItems > 0
          ? `${totalItems.toLocaleString()} 件中 ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalItems)} 件表示`
          : ''}
      </span>
      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={loading || currentPage <= 1}
          className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
        >◀ 前</button>
        <span className="text-nndd-subtext px-2">
          {currentPage} / {Math.ceil(totalItems / PAGE_SIZE)}
        </span>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={loading || currentPage >= Math.ceil(totalItems / PAGE_SIZE)}
          className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
        >次 ▶</button>
      </div>
    </div>
  );
}
