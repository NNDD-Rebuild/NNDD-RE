import { useCallback, useEffect, useRef, useState } from 'react';
import type { NNDDREComment, NgListItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { CommentList } from './components/player/CommentList';
import { ensureCommandResolved } from './util/commentCommands';

interface InitData {
  videoId: string;
  title: string;
  comments: NNDDREComment[];
  localCommentXmlPath?: string;
  ichibaHtmlPath?: string;
}

type Tab = 'comments' | 'pastComments';

/** 分割チャンクサイズ (過去コメント非同期ロード用) */
const CHUNK_SIZE = 2000;

/**
 * コメント一覧専用ウィンドウのルートコンポーネント。
 * タブ: コメントリスト (今ログ) | 過去コメント
 */
export default function CommentApp(): JSX.Element {
  const [videoId, setVideoId] = useState('');
  const [title, setTitle] = useState('コメント一覧');
  const [comments, setComments] = useState<NNDDREComment[]>([]);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [ngList, setNgList] = useState<NgListItem[]>([]);
  const [tab, setTab] = useState<Tab>('comments');
  const [localXmlPath, setLocalXmlPath] = useState<string | undefined>(undefined);
  const [ichibaHtmlPath, setIchibaHtmlPath] = useState<string | undefined>(undefined);

  // 過去コメント
  const now = new Date();
  const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const localTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const [pastComments, setPastComments] = useState<NNDDREComment[]>([]);
  const [pastDate, setPastDate] = useState(localDateStr);
  const [pastTime, setPastTime] = useState(localTimeStr);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);

  // テーマ適用
  useEffect(() => {
    window.nndd.invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
  }, []);

  // NG リストロード
  useEffect(() => {
    window.nndd
      .invoke<NgListItem[]>(IpcChannel.NG_LIST_COMMENT)
      .then(setNgList)
      .catch(() => {});
  }, []);

  // 初期化データ受信 (ウィンドウ起動 / 動画切替)
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.COMMENT_WINDOW_INIT,
      (data: InitData) => {
        setVideoId(data.videoId);
        setTitle(data.title);
        setComments(data.comments.map(ensureCommandResolved));
        setLocalXmlPath(data.localCommentXmlPath);
        setIchibaHtmlPath(data.ichibaHtmlPath);
        setCurrentTimeSec(0);
        setPastComments([]);
        setPastError(null);
        setTab('comments');
        document.title = `コメント一覧 — ${data.title}`;
        window.nndd.send(IpcChannel.COMMENT_WINDOW_PAST_PUSH, null);
      }
    );
    return off;
  }, []);

  // コメント配列プッシュ
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.COMMENT_WINDOW_PUSH,
      (cs: NNDDREComment[]) => setComments(cs.map(ensureCommandResolved))
    );
    return off;
  }, []);

  // 再生位置プッシュ
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.COMMENT_WINDOW_TIME,
      (timeSec: number) => setCurrentTimeSec(timeSec)
    );
    return off;
  }, []);

  // タブ切替時に過去コメントの有効/無効をプレイヤーに通知
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = tab;
    if (tab === 'pastComments' && pastComments.length > 0) {
      window.nndd.send(IpcChannel.COMMENT_WINDOW_PAST_PUSH, pastComments);
    } else if (prev === 'pastComments' && tab !== 'pastComments') {
      window.nndd.send(IpcChannel.COMMENT_WINDOW_PAST_PUSH, null);
    }
  }, [tab, pastComments]);

  const handleSeek = useCallback((timeSec: number): void => {
    window.nndd.send(IpcChannel.COMMENT_WINDOW_SEEK, timeSec);
  }, []);

  const handleAddNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_COMMENT, item);
    setNgList((prev) =>
      prev.some((x) => x.type === item.type && x.value === item.value)
        ? prev
        : [...prev, item]
    );
  }, []);

  const handleRemoveNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_COMMENT, item);
    setNgList((prev) =>
      prev.filter((x) => !(x.type === item.type && x.value === item.value))
    );
  }, []);

  const handleRefetch = useCallback(async (): Promise<string | undefined> => {
    if (!videoId || !localXmlPath) return;
    // 全量再取得 + diff マージ
    const result = await window.nndd.invoke<{ added: number }>(
      IpcChannel.PAST_COMMENT_REFETCH,
      videoId,
      localXmlPath
    );
    // 今ログ (最近 1000 件) を更新
    const cs = await window.nndd.invoke<NNDDREComment[]>(
      IpcChannel.COMMENT_READ_LOCAL,
      localXmlPath
    );
    const recent = [...cs]
      .sort((a, b) => b.no - a.no)
      .slice(0, 1000)
      .sort((a, b) => a.vposMs - b.vposMs);
    setComments(recent.map(ensureCommandResolved));
    return `+${result.added} 件追加`;
  }, [videoId, localXmlPath]);

  const getWhenUnixSec = useCallback((): number => {
    try {
      return Math.floor(new Date(`${pastDate}T${pastTime}`).getTime() / 1000);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }, [pastDate, pastTime]);

  /**
   * ローカルXMLを日時フィルタして過去コメント取得。
   * 大量データは CHUNK_SIZE ずつ非同期で state に積み込む。
   */
  const handleFilterFromLocal = useCallback(async (): Promise<void> => {
    if (!localXmlPath) return;
    setPastLoading(true);
    setPastError(null);
    setPastComments([]);
    try {
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        IpcChannel.PAST_COMMENT_FETCH_LOCAL,
        localXmlPath,
        getWhenUnixSec()
      );
      const resolved = cs.map(ensureCommandResolved);

      if (resolved.length <= CHUNK_SIZE) {
        setPastComments(resolved);
        if (tab === 'pastComments') {
          window.nndd.send(IpcChannel.COMMENT_WINDOW_PAST_PUSH, resolved);
        }
      } else {
        setPastComments(resolved.slice(0, CHUNK_SIZE));
        let offset = CHUNK_SIZE;
        const loadNext = (): void => {
          offset += CHUNK_SIZE;
          const chunk = resolved.slice(offset - CHUNK_SIZE, offset);
          setPastComments((prev) => [...prev, ...chunk]);
          if (offset < resolved.length) {
            setTimeout(loadNext, 16);
          } else {
            if (tab === 'pastComments') {
              window.nndd.send(IpcChannel.COMMENT_WINDOW_PAST_PUSH, resolved);
            }
          }
        };
        setTimeout(loadNext, 16);
      }
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
    }
  }, [localXmlPath, getWhenUnixSec, tab]);

  // handleFilterFromLocal の最新参照 (タブ自動ロード用)
  const handleFilterRef = useRef(handleFilterFromLocal);
  useEffect(() => { handleFilterRef.current = handleFilterFromLocal; }, [handleFilterFromLocal]);

  // 過去コメントタブに切替わった際に初回自動ロード
  useEffect(() => {
    if (tab !== 'pastComments') return;
    if (pastComments.length > 0 || pastLoading) return;
    if (!localXmlPath) return;
    handleFilterRef.current();
  // tab が変わった時だけ発火
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleResetDate = useCallback((): void => {
    const d = new Date();
    setPastDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    setPastTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-nndd-bg text-nndd-text">
      <div className="shrink-0 px-3 py-1 bg-nndd-panel border-b border-nndd-border text-xs text-nndd-subtext flex items-center gap-2">
        <span className="flex-1 truncate">{title || 'コメント一覧'}</span>
        {ichibaHtmlPath && (
          <button
            onClick={() => window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, ichibaHtmlPath)}
            className="shrink-0 px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
            title="ニコニコ市場情報を開く (旧NNDD互換ファイル)"
          >
            🛒 市場
          </button>
        )}
      </div>

      {/* タブバー */}
      <div className="flex shrink-0 border-b border-nndd-border">
        <TabButton
          label={`コメントリスト${comments.length > 0 ? ` (${comments.length.toLocaleString()})` : ''}`}
          active={tab === 'comments'}
          onClick={() => setTab('comments')}
        />
        <TabButton
          label={`過去コメント${pastComments.length > 0 ? ` (${pastComments.length.toLocaleString()})` : ''}`}
          active={tab === 'pastComments'}
          onClick={() => setTab('pastComments')}
          tooltip="タブが開いている間は動画にも過去コメントが描画されます"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'comments' ? (
          <CommentList
            comments={comments}
            ngList={ngList}
            onSeek={handleSeek}
            currentTimeMs={currentTimeSec * 1000}
            onAddNg={handleAddNg}
            onRemoveNg={handleRemoveNg}
            onRefetchComments={videoId && localXmlPath ? handleRefetch : undefined}
          />
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="shrink-0 p-2 border-b border-nndd-border bg-nndd-panel">
              <div className="flex items-center gap-1 flex-wrap mb-1">
                <input
                  type="date"
                  value={pastDate}
                  onChange={(e) => setPastDate(e.target.value)}
                  className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
                />
                <input
                  type="time"
                  value={pastTime}
                  onChange={(e) => setPastTime(e.target.value)}
                  className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
                />
                <button
                  onClick={handleResetDate}
                  title="現在時刻にリセット"
                  className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent/50 text-nndd-text"
                >
                  リセット
                </button>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {localXmlPath ? (
                  <button
                    onClick={handleFilterFromLocal}
                    disabled={pastLoading}
                    title="ローカルXMLから指定日時以前のコメントを読み込みます"
                    className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
                  >
                    {pastLoading ? '読込中…' : 'フィルタ'}
                  </button>
                ) : (
                  <span className="text-xs text-nndd-subtext">
                    ローカルファイルがありません (ダウンロード後に利用可)
                  </span>
                )}
                {pastError && (
                  <span className="text-xs text-red-500 dark:text-red-400 truncate flex-1" title={pastError}>
                    ⚠ {pastError}
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {pastComments.length > 0 ? (
                <CommentList
                  comments={pastComments}
                  ngList={ngList}
                  onSeek={handleSeek}
                  currentTimeMs={currentTimeSec * 1000}
                  onAddNg={handleAddNg}
                  onRemoveNg={handleRemoveNg}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">
                  {pastLoading ? '読込中…' : '過去コメントなし'}
                </div>
              )}
            </div>
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
