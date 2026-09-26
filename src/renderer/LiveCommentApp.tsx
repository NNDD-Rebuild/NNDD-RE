import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveCommentWindowMessage,
  LiveListItem,
  LiveProgramInfo,
  LiveStatistics,
  NgListItem,
  NNDDREComment
} from '@shared/types';
import { IpcChannel } from '@shared/types';
import { CommentList } from './components/player/CommentList';
import { useConfig } from './hooks/useConfig';

type Tab = 'comments' | 'notices';

function formatVpos(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 生放送のコメントウィンドウ (live-comment.html)。
 * 見た目・操作は通常の動画プレイヤーのコメントウィンドウ (CommentApp) と揃え、同じ CommentList を使う。
 * コメントのデータは生放送プレイヤーが持ち、main 経由で snapshot / append / position が届く。
 */
export default function LiveCommentApp(): JSX.Element {
  const itemsRef = useRef<LiveListItem[]>([]);
  const keysRef = useRef(new Set<string>());
  const [items, setItems] = useState<LiveListItem[]>([]);
  const [positionMs, setPositionMs] = useState(0);
  const [program, setProgram] = useState<LiveProgramInfo | null>(null);
  const [statistics, setStatistics] = useState<LiveStatistics | null>(null);
  const [canSeek, setCanSeek] = useState(false);
  const [ngList, setNgList] = useState<NgListItem[]>([]);
  const [tab, setTab] = useState<Tab>('comments');
  const [onTop, , onTopLoading] = useConfig<boolean>('live.commentWindowOnTop', true);
  const [onTopState, setOnTopState] = useState(true);

  // テーマ適用 (CommentApp と同じ)
  useEffect(() => {
    window.nndd
      .invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => {
        if (v === 'light') document.documentElement.classList.add('light');
      })
      .catch(() => {});
  }, []);

  // NG リストロード
  useEffect(() => {
    window.nndd
      .invoke<NgListItem[]>(IpcChannel.NG_LIST_COMMENT)
      .then(setNgList)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!onTopLoading) setOnTopState(onTop);
  }, [onTop, onTopLoading]);

  useEffect(() => {
    const off = window.nndd.on(IpcChannel.LIVE_COMMENT_WINDOW_PUSH, (...args: unknown[]) => {
      const msg = args[0] as LiveCommentWindowMessage;
      switch (msg.type) {
        case 'snapshot':
          itemsRef.current = [...msg.items];
          keysRef.current = new Set(msg.items.map((i) => i.key));
          setItems(itemsRef.current);
          setProgram(msg.program);
          setStatistics(msg.statistics);
          setCanSeek(msg.canSeek);
          if (msg.program) document.title = `コメント一覧 — ${msg.program.title}`;
          break;
        case 'append': {
          let added = false;
          for (const it of msg.items) {
            if (keysRef.current.has(it.key)) continue;
            keysRef.current.add(it.key);
            itemsRef.current.push(it);
            added = true;
          }
          if (added) {
            itemsRef.current.sort((a, b) => a.vposMs - b.vposMs);
            setItems([...itemsRef.current]);
          }
          break;
        }
        case 'position':
          setPositionMs(msg.vposMs);
          break;
        case 'statistics':
          setStatistics(msg.statistics);
          break;
      }
    });
    // リスナー登録後に準備完了を通知 → プレイヤーから snapshot が届く
    window.nndd.send(IpcChannel.LIVE_COMMENT_WINDOW_READY);
    return off;
  }, []);

  const comments = useMemo<NNDDREComment[]>(
    () => items.flatMap((i) => (i.comment ? [i.comment] : [])),
    [items]
  );
  const notices = useMemo(() => items.filter((i) => i.notice), [items]);

  const handleSeek = useCallback(
    (timeSec: number) => window.nndd.send(IpcChannel.LIVE_COMMENT_WINDOW_SEEK, timeSec * 1000),
    []
  );

  const handleAddNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_COMMENT, item);
    setNgList((prev) =>
      prev.some((x) => x.type === item.type && x.value === item.value) ? prev : [...prev, item]
    );
  }, []);

  const handleRemoveNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_COMMENT, item);
    setNgList((prev) => prev.filter((x) => !(x.type === item.type && x.value === item.value)));
  }, []);

  const toggleOnTop = (v: boolean): void => {
    setOnTopState(v);
    window.nndd.send(IpcChannel.LIVE_COMMENT_WINDOW_SET_ON_TOP, v);
  };

  return (
    <div className="flex flex-col h-screen bg-nndd-bg text-nndd-text">
      <div className="shrink-0 px-3 py-1 bg-nndd-panel border-b border-nndd-border text-xs text-nndd-subtext flex items-center gap-2">
        <span className="flex-1 truncate">{program?.title || 'コメント一覧'}</span>
        {statistics && (
          <span className="shrink-0 tabular-nums">
            来場 {statistics.viewers.toLocaleString()} / コメ {statistics.comments.toLocaleString()}
          </span>
        )}
        <label className="shrink-0 flex items-center gap-1 cursor-pointer select-none">
          <input type="checkbox" checked={onTopState} onChange={(e) => toggleOnTop(e.target.checked)} />
          最前面
        </label>
      </div>

      {/* タブバー */}
      <div className="flex shrink-0 border-b border-nndd-border">
        <TabButton
          label={`コメントリスト${comments.length > 0 ? ` (${comments.length.toLocaleString()})` : ''}`}
          active={tab === 'comments'}
          onClick={() => setTab('comments')}
        />
        <TabButton
          label={`お知らせ${notices.length > 0 ? ` (${notices.length.toLocaleString()})` : ''}`}
          active={tab === 'notices'}
          onClick={() => setTab('notices')}
          tooltip="運営コメント・ギフト・ニコニ広告などの通知"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'comments' ? (
          <CommentList
            comments={comments}
            ngList={ngList}
            onSeek={canSeek ? handleSeek : undefined}
            currentTimeMs={positionMs}
            onAddNg={handleAddNg}
            onRemoveNg={handleRemoveNg}
          />
        ) : (
          <div className="h-full overflow-auto text-xs">
            {notices.length === 0 ? (
              <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">お知らせなし</div>
            ) : (
              notices.map((n) => (
                <div key={n.key} className="flex gap-2 px-2 py-1 border-b border-nndd-border/30">
                  <span className="shrink-0 font-mono text-nndd-subtext">{formatVpos(n.vposMs)}</span>
                  <span className="break-all">{n.notice!.text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  tooltip
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tooltip?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={[
        'flex-1 text-xs py-1.5 px-2 border-b-2 transition-colors truncate',
        active
          ? 'border-nndd-accent text-nndd-text font-bold'
          : 'border-transparent text-nndd-subtext hover:text-nndd-text'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
