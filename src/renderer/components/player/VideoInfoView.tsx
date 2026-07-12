import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import type { WatchPageInfo, NNDDREComment, NgListItem, MyListItem } from '@shared/types';
import { IpcChannel, NgListItemType } from '@shared/types';
import { CommentList } from './CommentList';
import { ensureCommandResolved } from '../../util/commentCommands';
import { ContextMenuPopup, MenuItem } from '../common/VideoCard';

interface Props {
  watch: WatchPageInfo | null;
  comments?: NNDDREComment[];
  video?: HTMLVideoElement | null;
  /** 動画ID (コメント再取得・NG保存に使用) */
  videoId?: string;
  /** ローカル再生時 true → 再取得ボタンを表示 */
  isLocal?: boolean;
  /** ローカルコメントXMLパス (過去コメントのローカルフィルタに使用) */
  localCommentXmlPath?: string;
  /** ニコニコ市場情報HTMLパス (旧NNDDファイル) */
  ichibaHtmlPath?: string;
  /** false のとき コメント一覧タブを隠す (別ウィンドウモード時) */
  showCommentTab?: boolean;
  /** コメント更新コールバック (再取得後に親の state を更新) */
  onCommentsUpdated?: (cs: NNDDREComment[]) => void;
  /** 過去コメント取得完了コールバック */
  onPastCommentsLoaded?: (cs: NNDDREComment[]) => void;
  /** 過去コメントタブのアクティブ状態変更コールバック */
  onPastCommentTabActive?: (active: boolean) => void;
  /** シリーズ連続再生フラグ */
  autoNextSeries?: boolean;
  /** 連続再生トグル */
  onAutoNextChange?: (v: boolean) => void;
  /** シリーズページ読み込み完了 */
  onSeriesPageLoaded?: (items: MyListItem[], page: number, totalPages: number, seriesId: string) => void;
  /** タブバーがペイン幅に収まらない時、必要な幅(px)を通知 (スクロールでなくペイン幅拡大で対応するため) */
  onTabsOverflow?: (neededWidth: number) => void;
}

type Tab = 'info' | 'comments' | 'pastComments' | 'series';

/** 分割チャンクサイズ (過去コメント非同期ロード用) */
const CHUNK_SIZE = 2000;

/**
 * 動画情報パネル。
 * タブ: 動画情報 / コメント一覧 / 過去コメント
 * 元: VideoInfoView.mxml / VideoInfoView.as
 */
export function VideoInfoView({
  watch,
  comments = [],
  video,
  videoId,
  isLocal = false,
  localCommentXmlPath,
  ichibaHtmlPath,
  showCommentTab = true,
  onCommentsUpdated,
  onPastCommentsLoaded,
  onPastCommentTabActive,
  autoNextSeries = false,
  onAutoNextChange,
  onSeriesPageLoaded,
  onTabsOverflow
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('info');
  const [controlUiSize] = useConfig<'small' | 'normal' | 'large'>('player.controlUiSize', 'small');
  const tabZoom = controlUiSize === 'large' ? 1.5 : controlUiSize === 'normal' ? 1.3 : 1;
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [ngList, setNgList] = useState<NgListItem[]>([]);

  // 過去コメント状態
  const [pastComments, setPastComments] = useState<NNDDREComment[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  // 選択日時 (デフォルト: 現在)
  const now = new Date();
  const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const localTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const [pastDate, setPastDate] = useState(localDateStr);
  const [pastTime, setPastTime] = useState(localTimeStr);
  // ストリーミング時の過去コメント取得件数上限
  const [pastFetchMaxCount, setPastFetchMaxCount] = useState(10_000);
  const [pastProgressMsg, setPastProgressMsg] = useState<string | null>(null);

  // NG リストを初回ロード
  useEffect(() => {
    window.nndd
      .invoke<NgListItem[]>(IpcChannel.NG_LIST_COMMENT)
      .then(setNgList)
      .catch(() => {});
  }, []);

  // 過去コメント取得 (ストリーミング時) の進捗通知を購読
  useEffect(() => {
    return window.nndd.on(IpcChannel.PAST_COMMENT_FETCH_PROGRESS, (...args: unknown[]) => {
      setPastProgressMsg(args[0] as string);
    });
  }, []);

  // 再生位置追跡
  useEffect(() => {
    if (!video) return;
    const onTime = (): void => setCurrentTimeMs(video.currentTime * 1000);
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [video]);

  // showCommentTab が false になったらコメント系タブを 'info' に戻す
  useEffect(() => {
    if (!showCommentTab && (tab === 'comments' || tab === 'pastComments')) setTab('info');
  }, [showCommentTab, tab]);

  // シリーズ無しの動画に切り替わった時、シリーズタブを 'info' に戻す
  useEffect(() => {
    if (!watch?.series && tab === 'series') setTab('info');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch?.series]);

  // タブバーがペイン幅に収まらない時、必要な幅を親に通知 (スクロールでなくペイン幅拡大で対応)
  // outer: overflow-x-auto なスクロールコンテナ。CSSの zoom は「zoom適用要素自身の
  // scrollWidth」には反映されず zoom未適用の内部座標系の値を返す一方、
  // 「zoom非適用の親から見た占有幅」には反映される (実測: zoom=1.5 で inner.scrollWidth=304,
  // outer.scrollWidth=456=304*1.5)。そのため判定・必要幅の計算は必ず outer 側の値を使う。
  // inner(zoom適用+w-max)は、タブ増減による中身のサイズ変化を ResizeObserver に伝える
  // トリガーとしてのみ用いる。
  const tabBarOuterRef = useRef<HTMLDivElement>(null);
  const tabBarInnerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outer = tabBarOuterRef.current;
    const inner = tabBarInnerRef.current;
    if (!outer || !inner || !onTabsOverflow) return;

    const checkOverflow = (): void => {
      if (outer.scrollWidth > outer.clientWidth) {
        onTabsOverflow(outer.scrollWidth);
      }
    };

    const ro = new ResizeObserver(checkOverflow);
    ro.observe(outer);
    ro.observe(inner);
    checkOverflow();
    return () => ro.disconnect();
  }, [onTabsOverflow]);

  // タブ変更時に過去コメントタブのアクティブ状態を親に通知
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = tab;
    if (tab === 'pastComments') {
      onPastCommentTabActive?.(true);
    } else if (prevTab === 'pastComments') {
      onPastCommentTabActive?.(false);
    }
  }, [tab, onPastCommentTabActive]);

  const handleSeek = useCallback(
    (timeSec: number): void => {
      if (!video) return;
      video.currentTime = timeSec;
    },
    [video]
  );

  const handleAddNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_ADD_COMMENT, item);
    setNgList((prev) => {
      const exists = prev.some((x) => x.type === item.type && x.value === item.value);
      return exists ? prev : [...prev, item];
    });
  }, []);

  const handleRemoveNg = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(IpcChannel.NG_REMOVE_COMMENT, item);
    setNgList((prev) =>
      prev.filter((x) => !(x.type === item.type && x.value === item.value))
    );
  }, []);

  const handleRefetchComments = useCallback(async (): Promise<string | undefined> => {
    if (!videoId) return;
    if (localCommentXmlPath) {
      // ローカル再生: 全量再取得 + diff マージ → XML 再読み込み
      const result = await window.nndd.invoke<{ added: number }>(
        IpcChannel.PAST_COMMENT_REFETCH,
        videoId,
        localCommentXmlPath
      );
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        IpcChannel.COMMENT_READ_LOCAL,
        localCommentXmlPath
      );
      // 最近 1000 件に絞って今ログ更新
      const recent = [...cs]
        .sort((a, b) => b.no - a.no)
        .slice(0, 1000)
        .sort((a, b) => a.vposMs - b.vposMs);
      onCommentsUpdated?.(recent.map(ensureCommandResolved));
      return `+${result.added} 件追加`;
    } else {
      // ストリーミング再生: 通常のコメント再取得
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        IpcChannel.VIDEO_GET_COMMENTS,
        videoId
      );
      onCommentsUpdated?.(cs);
      return undefined;
    }
  }, [videoId, localCommentXmlPath, onCommentsUpdated]);

  /** 選択日時を Unix 秒に変換 */
  const getWhenUnixSec = useCallback((): number => {
    try {
      return Math.floor(new Date(`${pastDate}T${pastTime}`).getTime() / 1000);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }, [pastDate, pastTime]);

  /**
   * 取得済みコメントを CHUNK_SIZE ずつ非同期で state に積み込む (大量データの表示用)。
   */
  const loadPastCommentsChunked = useCallback((cs: NNDDREComment[]): void => {
    const resolved = cs.map(ensureCommandResolved);

    if (resolved.length <= CHUNK_SIZE) {
      setPastComments(resolved);
      onPastCommentsLoaded?.(resolved);
    } else {
      // 初回チャンクを即座に表示し、残りを非同期で追加
      setPastComments(resolved.slice(0, CHUNK_SIZE));
      let offset = CHUNK_SIZE;
      const loadNext = (): void => {
        offset += CHUNK_SIZE;
        const chunk = resolved.slice(offset - CHUNK_SIZE, offset);
        setPastComments((prev) => [...prev, ...chunk]);
        if (offset < resolved.length) {
          setTimeout(loadNext, 16);
        } else {
          onPastCommentsLoaded?.(resolved);
        }
      };
      setTimeout(loadNext, 16);
    }
  }, [onPastCommentsLoaded]);

  /**
   * ローカルXMLを日時フィルタして過去コメント取得。
   */
  const handleFilterFromLocal = useCallback(async (): Promise<void> => {
    const xmlPath = localCommentXmlPath;
    if (!xmlPath) return;
    setPastLoading(true);
    setPastError(null);
    setPastComments([]);
    try {
      const whenSec = getWhenUnixSec();
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        IpcChannel.PAST_COMMENT_FETCH_LOCAL,
        xmlPath,
        whenSec
      );
      loadPastCommentsChunked(cs);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
    }
  }, [localCommentXmlPath, getWhenUnixSec, loadPastCommentsChunked]);

  /**
   * ストリーミング再生時、ニコニコから直接過去コメントを取得。
   * 件数上限(pastFetchMaxCount)まで取得するため、取得中は進捗を表示する。
   */
  const handleFetchPastCommentsFromNico = useCallback(async (): Promise<void> => {
    if (!videoId) return;
    setPastLoading(true);
    setPastError(null);
    setPastComments([]);
    setPastProgressMsg(null);
    try {
      const whenSec = getWhenUnixSec();
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        IpcChannel.PAST_COMMENT_FETCH,
        videoId,
        whenSec,
        pastFetchMaxCount
      );
      loadPastCommentsChunked(cs);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
      setPastProgressMsg(null);
    }
  }, [videoId, getWhenUnixSec, pastFetchMaxCount, loadPastCommentsChunked]);

  // handleFilterFromLocal の最新参照 (タブ自動ロード用)
  const handleFilterRef = useRef(handleFilterFromLocal);
  useEffect(() => { handleFilterRef.current = handleFilterFromLocal; }, [handleFilterFromLocal]);

  // 過去コメントタブに切替わった際に初回自動ロード
  useEffect(() => {
    if (tab !== 'pastComments') return;
    if (pastComments.length > 0 || pastLoading) return;
    if (!localCommentXmlPath) return;
    handleFilterRef.current();
  // tab が変わった時だけ発火
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** 日時を現在にリセット */
  const handleResetDate = useCallback((): void => {
    const d = new Date();
    setPastDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    setPastTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* タブバー: outer=生px幅のスクロールコンテナ, inner=zoom適用+content-fit幅 */}
      <div ref={tabBarOuterRef} className="shrink-0 border-b border-nndd-border overflow-x-auto">
        <div ref={tabBarInnerRef} className="flex w-max" style={{ zoom: tabZoom }}>
          <TabButton
            label="動画情報"
            active={tab === 'info'}
            onClick={() => setTab('info')}
          />
          {showCommentTab && (
            <TabButton
              label={`コメントリスト${comments.length > 0 ? ` (${comments.length.toLocaleString()})` : ''}`}
              active={tab === 'comments'}
              onClick={() => setTab('comments')}
            />
          )}
          {showCommentTab && (
            <TabButton
              label={`過去コメント${pastComments.length > 0 ? ` (${pastComments.length.toLocaleString()})` : ''}`}
              active={tab === 'pastComments'}
              onClick={() => setTab('pastComments')}
              tooltip="過去コメントを表示します。このタブが開いている間だけ過去コメントが動画に描画されます。"
            />
          )}
          {watch?.series && (
            <TabButton
              label="シリーズ"
              active={tab === 'series'}
              onClick={() => setTab('series')}
            />
          )}
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'info' ? (
          <InfoContent watch={watch} ichibaHtmlPath={ichibaHtmlPath} />
        ) : tab === 'series' && watch?.series ? (
          <SeriesTabContent
            seriesId={watch.series.id}
            seriesTitle={watch.series.title}
            currentVideoId={watch.videoId}
            autoNext={autoNextSeries}
            onAutoNextChange={onAutoNextChange}
            onPageLoaded={onSeriesPageLoaded}
          />
        ) : tab === 'comments' ? (
          <CommentList
            comments={comments}
            ngList={ngList}
            onSeek={handleSeek}
            currentTimeMs={currentTimeMs}
            onAddNg={handleAddNg}
            onRemoveNg={handleRemoveNg}
            onRefetchComments={isLocal ? handleRefetchComments : undefined}
          />
        ) : (
          /* 過去コメントタブ */
          <div className="flex flex-col h-full min-h-0">
            {/* 日時選択 + ボタン */}
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
                {localCommentXmlPath ? (
                  <button
                    onClick={handleFilterFromLocal}
                    disabled={pastLoading}
                    title="ローカルXMLから指定日時以前のコメントを読み込みます"
                    className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
                  >
                    {pastLoading ? '読込中…' : 'フィルタ'}
                  </button>
                ) : videoId ? (
                  <>
                    <select
                      value={pastFetchMaxCount}
                      onChange={(e) => setPastFetchMaxCount(Number(e.target.value))}
                      disabled={pastLoading}
                      title="取得する過去コメントの最大件数"
                      className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text disabled:opacity-50"
                    >
                      {[1000, 5000, 10000, 30000, 50000].map((n) => (
                        <option key={n} value={n}>{n.toLocaleString()}件まで</option>
                      ))}
                    </select>
                    <button
                      onClick={handleFetchPastCommentsFromNico}
                      disabled={pastLoading}
                      title="ニコニコから直接、指定日時以前の過去コメントを取得します(時間がかかる場合があります)"
                      className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
                    >
                      {pastLoading ? '取得中…' : '取得'}
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-nndd-subtext">
                    過去コメントを取得できません
                  </span>
                )}
                {pastError && (
                  <span className="text-xs text-red-500 dark:text-red-400 truncate flex-1" title={pastError}>
                    ⚠ {pastError}
                  </span>
                )}
              </div>
              {pastLoading && pastProgressMsg && (
                <div className="text-xs text-nndd-subtext mt-0.5 truncate">{pastProgressMsg}</div>
              )}
            </div>

            {/* 過去コメント一覧 */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {pastComments.length > 0 ? (
                <CommentList
                  comments={pastComments}
                  ngList={ngList}
                  onSeek={handleSeek}
                  currentTimeMs={currentTimeMs}
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
        'shrink-0 text-xs py-1.5 px-2 border-b-2 transition-colors truncate',
        active
          ? 'border-nndd-accent text-nndd-text font-bold'
          : 'border-transparent text-nndd-subtext hover:text-nndd-text'
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function InfoContent({ watch, ichibaHtmlPath }: { watch: WatchPageInfo | null; ichibaHtmlPath?: string }): JSX.Element {
  const [openVideoLinkInPlayer] = useConfig<boolean>('player.openVideoLinkInPlayer', false);
  const [ownerCtxMenu, setOwnerCtxMenu] = useState<{ x: number; y: number } | null>(null);

  if (!watch) {
    return (
      <div className="p-4 text-nndd-subtext text-sm">
        動画情報を読み込み中…
      </div>
    );
  }

  const handleDescClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    const url = target.dataset.url || target.closest('[data-url]')?.getAttribute('data-url');
    if (url) {
      e.preventDefault();
      // mylist URL → アプリ内マイリストタブで開く
      const mylistMatch =
        url.match(/nicovideo\.jp\/my\/mylist\/(\d+)/) ??
        url.match(/nicovideo\.jp\/mylist\/(\d+)/);
      const seriesMatch = url.match(/nicovideo\.jp\/series\/(\d+)/);
      const videoMatch = openVideoLinkInPlayer
        ? url.match(/nicovideo\.jp\/watch\/((?:sm|nm|so|ss)\d+)/)
        : null;
      if (mylistMatch) {
        window.nndd.invoke(IpcChannel.NAV_MYLIST, mylistMatch[1]);
      } else if (seriesMatch) {
        window.nndd.invoke(IpcChannel.NAV_SERIES, seriesMatch[1]);
      } else if (videoMatch) {
        window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId: videoMatch[1] });
      } else {
        window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, url);
      }
    }
  };

  const nicoUrl = `https://www.nicovideo.jp/watch/${watch.videoId}`;

  return (
    <div className="overflow-auto h-full p-3 text-sm text-nndd-text">
      <h1 className="text-base font-bold mb-1">{watch.title}</h1>
      <div className="text-xs text-nndd-subtext mb-1">
        投稿: {watch.registeredAt} ・ 再生 {watch.count.view.toLocaleString()} ・
        コメ {watch.count.comment.toLocaleString()} ・ マイリス{' '}
        {watch.count.mylist.toLocaleString()} ・ いいね{' '}
        {watch.count.like.toLocaleString()}
      </div>
      <div className="text-xs mb-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, nicoUrl)}
          className="text-nndd-accent underline hover:opacity-80"
          title={nicoUrl}
        >
          {watch.videoId} →ニコニコで見る
        </button>
        {ichibaHtmlPath && (
          <button
            onClick={() => window.nndd.invoke(window.nndd.channels.SYS_OPEN_IN_BROWSER, ichibaHtmlPath)}
            className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
            title="ニコニコ市場情報を開く (旧NNDD互換ファイル)"
          >
            🛒 市場
          </button>
        )}
      </div>

      {watch.owner && (
        <div className="flex items-center gap-2 mb-3">
          {watch.owner.iconUrl && (
            <img
              src={watch.owner.iconUrl}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // キャッシュが失われた場合などに非表示
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <button
            onClick={() =>
              window.nndd.invoke(IpcChannel.NAV_FOLLOW_USER, {
                userId: String(watch.owner!.id),
                nickname: watch.owner!.nickname,
                iconUrl: watch.owner!.iconUrl
              })
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setOwnerCtxMenu({ x: e.clientX, y: e.clientY });
            }}
            className="text-sm hover:text-nndd-accent hover:underline"
            title="クリック: フォロー中タブでこの投稿者の動画を表示 (右クリックでメニュー)"
          >
            {watch.owner.nickname}
          </button>
          {ownerCtxMenu && (
            <ContextMenuPopup
              x={ownerCtxMenu.x}
              y={ownerCtxMenu.y}
              onClose={() => setOwnerCtxMenu(null)}
            >
              <MenuItem
                onClick={() => {
                  window.nndd.invoke(
                    window.nndd.channels.SYS_OPEN_PATH,
                    `https://www.nicovideo.jp/user/${watch.owner!.id}`
                  );
                  setOwnerCtxMenu(null);
                }}
              >
                🌐 ユーザーページを開く
              </MenuItem>
            </ContextMenuPopup>
          )}
        </div>
      )}

      {watch.channel && (
        <div className="mb-3 text-xs">
          📺 {watch.channel.name}{' '}
          {watch.channel.isOfficialAnime && (
            <span className="text-nndd-accent ml-1">公式</span>
          )}
        </div>
      )}

      {watch.tags.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-1">タグ (ダブルクリックで検索)</div>
          <div className="flex flex-wrap gap-1">
            {watch.tags.map((t) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <span
                key={t}
                className="px-2 py-0.5 bg-nndd-border rounded text-xs cursor-pointer hover:bg-nndd-accent hover:text-white transition-colors"
                onDoubleClick={() => window.nndd.invoke(IpcChannel.NAV_SEARCH_TAG, t)}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <div className="text-xs text-nndd-subtext mb-1">説明</div>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className="text-sm leading-relaxed break-words whitespace-pre-wrap"
          dangerouslySetInnerHTML={{
            __html: sanitizeDescription(watch.description)
          }}
          onClick={handleDescClick}
        />
      </div>
    </div>
  );
}

const LINK_CLASS = 'style="color:#e94e1b;text-decoration:underline;cursor:pointer;pointer-events:auto"';

function sanitizeDescription(html: string): string {
  // 1. 危険タグ除去
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '');

  // 2. <a href="https://..."> → <a data-url="..."> (デフォルトナビゲーション無効化)
  s = s.replace(
    /<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi,
    (_m, pre, url, post) =>
      `<a ${pre}data-url="${url}" ${post} ${LINK_CLASS}>`
  );

  // 3. 既存の <a>...</a> をプレースホルダーに退避
  //    → アンカー内部で sm/mylist を二重リンク化しないため
  const anchors: string[] = [];
  s = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    anchors.push(match);
    return `\x00A${anchors.length - 1}\x00`;
  });

  // 4. プレーンテキストの https:// URL をリンク化 (ASCII文字のみ)
  s = s.replace(
    /(?<![="])((https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+))/g,
    `<a data-url="$1" ${LINK_CLASS}>$1</a>`
  );

  // 5. sm/nm/so/ss で始まる動画 ID をリンク化
  s = s.replace(
    /\b((?:sm|nm|so|ss)\d+)\b/g,
    `<a data-url="https://www.nicovideo.jp/watch/$1" ${LINK_CLASS}>$1</a>`
  );

  // 6. mylist/数字 をマイリストリンクに変換
  s = s.replace(
    /\b(mylist\/(\d+))\b/g,
    `<a data-url="https://www.nicovideo.jp/my/mylist/$2" ${LINK_CLASS}>$1</a>`
  );

  // 7. プレースホルダーを元のアンカーに戻す
  s = s.replace(/\x00A(\d+)\x00/g, (_, i) => anchors[Number(i)]);

  return s;
}

function LazyThumbnail({ url }: { url: string }): JSX.Element {
  const [src, setSrc] = useState('');
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!url || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          window.nndd
            .invoke<string>(IpcChannel.IMAGE_FETCH, url)
            .then(setSrc)
            .catch(() => setSrc(url));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url]);

  return (
    <img
      ref={ref}
      src={src}
      alt=""
      className="w-16 h-9 object-cover rounded shrink-0 bg-nndd-border"
    />
  );
}

function SeriesTabContent({
  seriesId,
  seriesTitle,
  currentVideoId,
  autoNext = false,
  onAutoNextChange,
  onPageLoaded
}: {
  seriesId: string;
  seriesTitle: string;
  currentVideoId: string;
  autoNext?: boolean;
  onAutoNextChange?: (v: boolean) => void;
  onPageLoaded?: (items: MyListItem[], page: number, totalPages: number, seriesId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<MyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  };

  const fetchSeriesPage = (targetPage?: number): void => {
    setLoading(true);
    setError(null);
    window.nndd
      .invoke<{ name: string; items: MyListItem[]; page: number; totalPages: number }>(
        IpcChannel.SERIES_FETCH, seriesId, targetPage ? undefined : currentVideoId, targetPage
      )
      .then((r) => {
        setItems(r.items);
        setPage(r.page);
        setTotalPages(r.totalPages);
        onPageLoaded?.(r.items, r.page, r.totalPages, seriesId);
        if (targetPage) listRef.current?.scrollTo(0, 0);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSeriesPage();
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [seriesId]);

  useEffect(() => {
    if (!loading && items.length > 0 && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [loading, items, currentVideoId]);

  const handleAddWatchLater = (videoId: string): void => {
    setAddingId(videoId);
    window.nndd
      .invoke(IpcChannel.MYLIST_ADD_VIDEO_DEFLIST, videoId)
      .then(() => {
        setAddedIds((prev) => new Set(prev).add(videoId));
        showToast('後でみるに追加しました');
      })
      .catch(() => showToast('追加に失敗しました'))
      .finally(() => setAddingId(null));
  };

  const handleAddToMylist = (): void => {
    window.nndd
      .invoke(IpcChannel.MYLIST_ADD, {
        myListUrl: `https://www.nicovideo.jp/series/${seriesId}`,
        myListName: seriesTitle,
        isDir: false,
        unPlayVideoCount: 0,
        type: 'series',
        myListVideoIds: {}
      })
      .then(() => showToast('マイリストに追加しました'))
      .catch(() => showToast('追加に失敗しました'));
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {toastMsg && (
        <div className="absolute bottom-2 left-2 right-2 z-10 px-3 py-1.5 rounded bg-nndd-accent text-white text-xs text-center shadow pointer-events-none">
          {toastMsg}
        </div>
      )}
      <div className="shrink-0 px-3 pt-2 pb-1 text-xs font-bold text-nndd-text truncate">
        {seriesTitle}
      </div>
      <div className="shrink-0 px-3 pb-2 border-b border-nndd-border flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => onAutoNextChange?.(e.target.checked)}
              className="accent-nndd-accent"
            />
            <span className="text-xs text-nndd-subtext">連続再生</span>
          </label>
          <button
            onClick={handleAddToMylist}
            className="text-xs text-nndd-subtext hover:text-nndd-text px-1.5 py-0.5 rounded border border-nndd-border hover:bg-nndd-border/50 transition-colors"
          >
            ★ マイリストに追加
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => fetchSeriesPage(page - 1)}
              disabled={loading || page <= 1}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >◀ 前</button>
            <span className="text-nndd-subtext px-2">{page} / {totalPages}</span>
            <button
              onClick={() => fetchSeriesPage(page + 1)}
              disabled={loading || page >= totalPages}
              className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-40"
            >次 ▶</button>
          </div>
        )}
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-3 text-xs text-nndd-subtext">読込中…</div>
        )}
        {error && (
          <div className="p-3 text-xs text-red-500 dark:text-red-400">{error}</div>
        )}
        {items.map((item) => (
          <div
            ref={item.videoId === currentVideoId ? activeRef : undefined}
            key={item.videoId}
            className={[
              'flex items-center gap-2 px-2 py-1.5',
              item.videoId === currentVideoId ? 'bg-nndd-accent/20' : ''
            ].join(' ')}
          >
            <button
              onClick={() =>
                window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId: item.videoId })
              }
              className="flex gap-2 flex-1 min-w-0 text-left hover:bg-nndd-border/50 rounded transition-colors"
            >
              {item.thumbnailUrl && (
                <LazyThumbnail url={item.thumbnailUrl} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-nndd-text leading-tight line-clamp-2">
                  {item.title}
                </div>
                <div className="text-xs text-nndd-subtext mt-0.5">{item.length}</div>
              </div>
            </button>
            <button
              onClick={() => handleAddWatchLater(item.videoId)}
              disabled={addingId === item.videoId || addedIds.has(item.videoId)}
              title="後でみるに追加"
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-nndd-border/70 text-nndd-subtext hover:text-nndd-text transition-colors disabled:opacity-40"
            >
              {addedIds.has(item.videoId) ? '✓' : '+'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
