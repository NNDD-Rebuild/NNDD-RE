import {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback
} from 'react';
import type { NNDDREComment, NgListItem } from '@shared/types';
import { NgListItemType, IpcChannel } from '@shared/types';
import { NgListDialog } from './NgListDialog';

// ── 列幅型 ──────────────────────────────────────────────
interface ColWidths {
  vposMs: number;
  text: number;
  userId: number;
  date: number;
  no: number;
  mail: number;
}

const DEFAULT_COL_WIDTHS: ColWidths = {
  vposMs: 40,
  text: 160,
  userId: 72,
  date: 90,
  no: 28,
  mail: 48
};

type ColKey = keyof ColWidths;

// ── コンテキストメニュー ─────────────────────────────────
interface ContextMenu {
  x: number;
  y: number;
  comment: NNDDREComment;
}

// ── Props ────────────────────────────────────────────────
interface Props {
  comments: NNDDREComment[];
  ngList: NgListItem[];
  onSeek?: (timeSec: number) => void;
  currentTimeMs?: number;
  onAddNg: (item: NgListItem) => void;
  onRemoveNg: (item: NgListItem) => void;
  /** コメント再取得。戻り値は結果メッセージ (例: "+1234 件追加") */
  onRefetchComments?: () => Promise<string | undefined>;
}

// ── 仮想スクロール定数 ───────────────────────────────────
const ROW_HEIGHT = 20; // px (py-0.5 × 2 + text-xs)
const OVERSCAN = 20;   // 上下バッファ行数

// ── ユーティリティ ───────────────────────────────────────
function formatVpos(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatDate(unixSec: number): string {
  if (!unixSec) return '';
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

type SortKey = 'vposMs' | 'no' | 'date';
type SortDir = 'asc' | 'desc';

function isNgComment(c: NNDDREComment, ngList: NgListItem[]): boolean {
  for (const ng of ngList) {
    if (ng.type === NgListItemType.USER_ID && c.userId === ng.value) return true;
    if (ng.type === NgListItemType.WORD && c.text.includes(ng.value)) return true;
    if (ng.type === NgListItemType.COMMAND && c.mail.includes(ng.value)) return true;
  }
  return false;
}

// ── メインコンポーネント ─────────────────────────────────
/**
 * コメント一覧テーブル (仮想スクロール対応)
 * 元: VideoInfoView.mxml の DataGrid (コメントリストタブ)
 */
export function CommentList({
  comments,
  ngList,
  onSeek,
  currentTimeMs,
  onAddNg,
  onRemoveNg,
  onRefetchComments
}: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('vposMs');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showNg, setShowNg] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showNgDialog, setShowNgDialog] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null);
  const [refetchErr, setRefetchErr] = useState<string | null>(null);

  // ── 列幅 ────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const colWidthsRef = useRef<ColWidths>(DEFAULT_COL_WIDTHS);
  const colDragState = useRef<{
    col: ColKey;
    startX: number;
    startW: number;
  } | null>(null);
  const [isDraggingCol, setIsDraggingCol] = useState(false);

  // 保存済み列幅のロード
  useEffect(() => {
    window.nndd
      .invoke<ColWidths>(IpcChannel.CONFIG_GET, 'player.commentColumnWidths')
      .then((saved) => {
        if (saved && typeof saved === 'object') {
          const merged = { ...DEFAULT_COL_WIDTHS, ...saved };
          setColWidths(merged);
          colWidthsRef.current = merged;
        }
      })
      .catch(() => {});
  }, []);

  // ref を state と同期
  useEffect(() => {
    colWidthsRef.current = colWidths;
  }, [colWidths]);

  // 列ドラッグ開始
  const onColResizeStart = useCallback(
    (col: ColKey, e: React.MouseEvent): void => {
      colDragState.current = {
        col,
        startX: e.clientX,
        startW: colWidthsRef.current[col]
      };
      setIsDraggingCol(true);
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  // 列ドラッグ mousemove / mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!colDragState.current) return;
      const { col, startX, startW } = colDragState.current;
      const dx = e.clientX - startX;
      const newW = Math.max(24, startW + dx);
      setColWidths((prev) => ({ ...prev, [col]: newW }));
    };
    const onUp = (e: MouseEvent): void => {
      if (!colDragState.current) return;
      const { col, startX, startW } = colDragState.current;
      colDragState.current = null;
      setIsDraggingCol(false);
      const dx = e.clientX - startX;
      const newW = Math.max(24, startW + dx);
      const toSave = { ...colWidthsRef.current, [col]: newW };
      window.nndd
        .invoke(IpcChannel.CONFIG_SET, 'player.commentColumnWidths', toSave)
        .catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── 仮想スクロール ────────────────────────────────────
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(500);

  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // ── コンテキストメニュー閉じ ──────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  // ── ソート ───────────────────────────────────────────
  const handleHeaderClick = useCallback((key: SortKey): void => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  // ── フィルター → ソート ──────────────────────────────
  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        c.text.toLowerCase().includes(q) ||
        c.userId.toLowerCase().includes(q) ||
        c.mail.toLowerCase().includes(q)
    );
  }, [comments, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'vposMs') diff = a.vposMs - b.vposMs;
      else if (sortKey === 'no') diff = a.no - b.no;
      else if (sortKey === 'date') diff = a.date - b.date;
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [filtered, sortKey, sortDir]);

  // 現在位置に最も近い行 index (sorted 内)
  const activeIndex = useMemo(() => {
    if (currentTimeMs == null || sorted.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].vposMs <= currentTimeMs) best = i;
      else break;
    }
    return best;
  }, [sorted, currentTimeMs]);

  // activeComment を O(1) で参照
  const activeComment = activeIndex >= 0 ? sorted[activeIndex] : null;

  const ngCount = useMemo(
    () => sorted.filter((c) => isNgComment(c, ngList)).length,
    [sorted, ngList]
  );

  const visibleRows = useMemo(
    () => (showNg ? sorted : sorted.filter((c) => !isNgComment(c, ngList))),
    [sorted, ngList, showNg]
  );

  // visibleRows 内での activeComment の行番号
  const visibleActiveIdx = useMemo(() => {
    if (!activeComment) return -1;
    return visibleRows.indexOf(activeComment);
  }, [activeComment, visibleRows]);

  // ── 自動スクロール ────────────────────────────────────
  useEffect(() => {
    if (!autoScroll || visibleActiveIdx < 0) return;
    const el = scrollBoxRef.current;
    if (!el) return;
    const target = visibleActiveIdx * ROW_HEIGHT - containerH / 2 + ROW_HEIGHT / 2;
    el.scrollTop = Math.max(0, target);
  }, [currentTimeMs, autoScroll, visibleActiveIdx, containerH]);

  // ── 仮想ウィンドウ計算 ────────────────────────────────
  const firstIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastIdx = Math.min(
    visibleRows.length - 1,
    Math.ceil((scrollTop + containerH) / ROW_HEIGHT) + OVERSCAN
  );
  const rowsSlice = visibleRows.slice(firstIdx, lastIdx + 1);
  const topPad = firstIdx * ROW_HEIGHT;
  const bottomPad = Math.max(0, (visibleRows.length - lastIdx - 1) * ROW_HEIGHT);
  const totalHeight = visibleRows.length * ROW_HEIGHT;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, c: NNDDREComment): void => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, comment: c });
    },
    []
  );

  const handleRefetch = useCallback(async (): Promise<void> => {
    if (!onRefetchComments || refetching) return;
    setRefetching(true);
    setRefetchMsg(null);
    setRefetchErr(null);
    try {
      const msg = await onRefetchComments();
      if (msg) setRefetchMsg(msg);
    } catch (e) {
      setRefetchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRefetching(false);
    }
  }, [onRefetchComments, refetching]);

  // テーブル幅 = 全列幅の合計
  const tableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      {/* ドラッグ中カーソル固定オーバーレイ */}
      {isDraggingCol && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}

      {/* ツールバー */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-nndd-border shrink-0">
        <input
          type="text"
          placeholder="フィルター…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-0 text-xs bg-nndd-bg border border-nndd-border rounded px-2 py-0.5 text-nndd-text placeholder-nndd-subtext focus:outline-none"
        />
        <label className="flex items-center gap-0.5 text-xs text-nndd-subtext shrink-0 cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          追従
        </label>
        {ngCount > 0 && (
          <label className="flex items-center gap-0.5 text-xs text-nndd-subtext shrink-0 cursor-pointer">
            <input type="checkbox" checked={showNg} onChange={(e) => setShowNg(e.target.checked)} />
            NG表示
          </label>
        )}
        <button
          onClick={() => setShowNgDialog(true)}
          className="text-xs text-nndd-subtext hover:text-nndd-text shrink-0 px-1"
          title="NG一覧"
        >
          NG一覧
        </button>
        {onRefetchComments && (
          <button
            onClick={handleRefetch}
            disabled={refetching}
            className="text-xs text-nndd-subtext hover:text-nndd-text shrink-0 px-1 disabled:opacity-50"
            title="全コメントを再取得して差分を保存"
          >
            {refetching ? '取得中…' : '再取得'}
          </button>
        )}
        {refetchMsg && (
          <span className="text-xs text-green-600 dark:text-green-400 shrink-0">{refetchMsg}</span>
        )}
        {refetchErr && (
          <span className="text-xs text-red-500 dark:text-red-400 shrink-0 truncate max-w-[120px]" title={refetchErr}>
            ⚠{refetchErr.slice(0, 20)}
          </span>
        )}
      </div>

      {/* テーブル (仮想スクロール) */}
      <div
        ref={scrollBoxRef}
        className="flex-1 overflow-auto min-h-0"
        onScroll={handleScroll}
      >
        <table
          className="table-fixed text-xs border-collapse"
          style={{ width: tableWidth, minWidth: tableWidth, height: totalHeight }}
        >
          <colgroup>
            {(Object.keys(colWidths) as ColKey[]).map((col) => (
              <col key={col} style={{ width: colWidths[col] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-nndd-bg z-10">
            <tr className="text-left border-b border-nndd-border text-nndd-subtext">
              <ResizableTh
                label="時間"
                colKey="vposMs"
                width={colWidths.vposMs}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={() => handleHeaderClick('vposMs')}
                onResizeStart={onColResizeStart}
              />
              <ResizableTh
                label="コメント"
                colKey="text"
                width={colWidths.text}
                sortable={false}
                onResizeStart={onColResizeStart}
              />
              <ResizableTh
                label="ユーザーID"
                colKey="userId"
                width={colWidths.userId}
                sortable={false}
                onResizeStart={onColResizeStart}
              />
              <ResizableTh
                label="投稿日時"
                colKey="date"
                width={colWidths.date}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={() => handleHeaderClick('date')}
                onResizeStart={onColResizeStart}
              />
              <ResizableTh
                label="番号"
                colKey="no"
                width={colWidths.no}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={() => handleHeaderClick('no')}
                onResizeStart={onColResizeStart}
              />
              <ResizableTh
                label="オプション"
                colKey="mail"
                width={colWidths.mail}
                sortable={false}
                onResizeStart={onColResizeStart}
              />
            </tr>
          </thead>
          <tbody>
            {/* 上部スペーサー */}
            {topPad > 0 && (
              <tr>
                <td colSpan={6} style={{ height: topPad, padding: 0 }} />
              </tr>
            )}
            {/* 表示行 */}
            {rowsSlice.map((c) => {
              const isActive = c === activeComment;
              const isNg = isNgComment(c, ngList);
              return (
                <tr
                  key={`${c.thread}-${c.fork ?? ''}-${c.no}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onSeek?.(c.vposMs / 1000)}
                  onContextMenu={(e) => handleContextMenu(e, c)}
                  className={[
                    'cursor-pointer border-b border-nndd-border/30 hover:bg-nndd-border/40',
                    isActive ? 'bg-nndd-accent/20' : '',
                    isNg ? 'opacity-40 line-through' : ''
                  ].join(' ')}
                  title={`${c.text}\nユーザーID: ${c.userId}\n投稿: ${formatDate(c.date)}`}
                >
                  <td className="px-1 py-0.5 font-mono text-nndd-subtext whitespace-nowrap overflow-hidden truncate">
                    {formatVpos(c.vposMs)}
                  </td>
                  <td className="px-1 py-0.5 truncate overflow-hidden max-w-0">
                    <CommentTextCell text={c.text} />
                  </td>
                  <td className="px-1 py-0.5 truncate overflow-hidden max-w-0 text-nndd-subtext">{c.userId}</td>
                  <td className="px-1 py-0.5 truncate overflow-hidden max-w-0 text-nndd-subtext">{formatDate(c.date)}</td>
                  <td className="px-1 py-0.5 text-right text-nndd-subtext overflow-hidden">{c.no}</td>
                  <td className="px-1 py-0.5 truncate overflow-hidden max-w-0 text-nndd-subtext">{c.mail}</td>
                </tr>
              );
            })}
            {/* 下部スペーサー */}
            {bottomPad > 0 && (
              <tr>
                <td colSpan={6} style={{ height: bottomPad, padding: 0 }} />
              </tr>
            )}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-nndd-subtext">
                  {filter ? 'コメントが見つかりません' : 'コメントなし'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* フッター */}
      <div className="px-2 py-0.5 text-xs text-nndd-subtext border-t border-nndd-border shrink-0 flex gap-2">
        <span>{visibleRows.length.toLocaleString()} / {comments.length.toLocaleString()} 件</span>
        {ngCount > 0 && <span className="text-red-500 dark:text-red-400">NG: {ngCount}</span>}
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          comment={contextMenu.comment}
          ngList={ngList}
          onAddNg={(item) => { onAddNg(item); setContextMenu(null); }}
          onRemoveNg={(item) => { onRemoveNg(item); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* NG一覧ダイアログ */}
      {showNgDialog && (
        <NgListDialog
          ngList={ngList}
          onAdd={onAddNg}
          onRemove={onRemoveNg}
          onClose={() => setShowNgDialog(false)}
        />
      )}
    </div>
  );
}

// ── リサイズ可能なヘッダーセル ────────────────────────────

interface ResizableThProps {
  label: string;
  colKey: ColKey;
  width: number;
  sortable?: boolean;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: () => void;
  onResizeStart: (col: ColKey, e: React.MouseEvent) => void;
}

function ResizableTh({
  label,
  colKey,
  width,
  sortable = true,
  sortKey,
  sortDir,
  onSort,
  onResizeStart
}: ResizableThProps): JSX.Element {
  const isActive = sortable && sortKey === colKey;
  return (
    <th
      className={[
        'relative px-1 py-1 font-normal truncate overflow-hidden',
        sortable ? 'cursor-pointer hover:text-nndd-text' : ''
      ].join(' ')}
      style={{ width }}
      onClick={sortable ? onSort : undefined}
    >
      {label}
      {isActive && (
        <span className="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
      )}
      {/* リサイズハンドル */}
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-nndd-accent/50 z-20"
        onMouseDown={(e) => {
          e.stopPropagation(); // ソートを誤発火させない
          onResizeStart(colKey, e);
        }}
      />
    </th>
  );
}

// ── コンテキストメニュー ──────────────────────────────────

function ContextMenuPopup({
  x, y, comment, ngList, onAddNg, onRemoveNg, onClose
}: {
  x: number; y: number; comment: NNDDREComment; ngList: NgListItem[];
  onAddNg: (item: NgListItem) => void;
  onRemoveNg: (item: NgListItem) => void;
  onClose: () => void;
}): JSX.Element {
  const isUserNg = ngList.some(
    (n) => n.type === NgListItemType.USER_ID && n.value === comment.userId
  );
  const isWordNg = ngList.some(
    (n) => n.type === NgListItemType.WORD && n.value === comment.text
  );

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(y, window.innerHeight - 160),
    left: Math.min(x, window.innerWidth - 220)
  };

  const shortText =
    comment.text.length > 20 ? comment.text.slice(0, 20) + '…' : comment.text;

  return (
    <div
      style={style}
      className="bg-nndd-panel border border-nndd-border rounded shadow-lg py-1 w-52 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-nndd-subtext truncate border-b border-nndd-border mb-1">
        {shortText || '(空コメント)'}
      </div>
      {comment.userId && (
        <MenuItem
          onClick={() =>
            isUserNg
              ? onRemoveNg({ type: NgListItemType.USER_ID, value: comment.userId })
              : onAddNg({ type: NgListItemType.USER_ID, value: comment.userId })
          }
          danger={!isUserNg}
        >
          {isUserNg
            ? 'ユーザー NG 解除'
            : `ユーザー「${comment.userId.slice(0, 10)}…」をNG`}
        </MenuItem>
      )}
      {comment.text && (
        <MenuItem
          onClick={() =>
            isWordNg
              ? onRemoveNg({ type: NgListItemType.WORD, value: comment.text })
              : onAddNg({ type: NgListItemType.WORD, value: comment.text })
          }
          danger={!isWordNg}
        >
          {isWordNg ? 'ワード NG 解除' : `「${shortText}」をNGワードに追加`}
        </MenuItem>
      )}
      <div className="border-t border-nndd-border mt-1 pt-1">
        <MenuItem onClick={onClose}>閉じる</MenuItem>
      </div>
    </div>
  );
}

// ── コメントテキスト (sm/nm/so/ss動画ID・mylistリンク化) ─────────────────

type TextPart =
  | { type: 'text'; value: string }
  | { type: 'video'; value: string }
  | { type: 'mylist'; id: string; value: string };

function parseCommentText(text: string): TextPart[] {
  const regex = /((?:sm|nm|so|ss)\d+)|(mylist\/(\d+))/g;
  const parts: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1]) {
      parts.push({ type: 'video', value: m[1] });
    } else if (m[2]) {
      parts.push({ type: 'mylist', id: m[3], value: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

function CommentTextCell({ text }: { text: string }): JSX.Element {
  const parts = parseCommentText(text);
  // リンクなければ素のspan
  if (parts.every((p) => p.type === 'text')) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'video') {
          return (
            <span
              key={i}
              className="text-blue-600 dark:text-blue-400 underline cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void window.nndd.invoke(
                  window.nndd.channels.SYS_OPEN_PATH,
                  `https://www.nicovideo.jp/watch/${p.value}`
                );
              }}
            >
              {p.value}
            </span>
          );
        }
        if (p.type === 'mylist') {
          return (
            <span
              key={i}
              className="text-blue-600 dark:text-blue-400 underline cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void window.nndd.invoke(
                  window.nndd.channels.SYS_OPEN_PATH,
                  `https://www.nicovideo.jp/my/mylist/${p.id}`
                );
              }}
            >
              {p.value}
            </span>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
}

function MenuItem({
  children, onClick, danger
}: {
  children: React.ReactNode; onClick: () => void; danger?: boolean;
}): JSX.Element {
  return (
    <button
      className={[
        'w-full text-left px-3 py-1.5 hover:bg-nndd-border/60 truncate block',
        danger ? 'text-red-500 dark:text-red-400' : 'text-nndd-text'
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
