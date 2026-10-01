import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import type { WatchPageInfo, NNDDREComment, NgListItem, MyListItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { CommentList } from './CommentList';
import { ensureCommandResolved } from '../../util/commentCommands';
import { TabButton } from './videoInfo/TabButton';
import { InfoContent } from './videoInfo/InfoContent';
import { SeriesTabContent } from './videoInfo/SeriesTabContent';
import { RelatedTabContent } from './videoInfo/RelatedTabContent';
import { PastCommentsPanel } from './videoInfo/PastCommentsPanel';

// 説明文ヘルパーは LiveProgramInfo などが従来どおりこのファイルから import できるよう再 export する
export { descriptionLinkUrl, openDescriptionUrl, sanitizeDescription } from './videoInfo/description';

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
  /** 関連動画連続再生フラグ */
  autoNextRelated?: boolean;
  /** 関連動画連続再生トグル */
  onAutoNextRelatedChange?: (v: boolean) => void;
  /** 関連動画一覧読み込み完了 */
  onRelatedLoaded?: (items: MyListItem[]) => void;
  /** タブバーがペイン幅に収まらない時、必要な幅(px)を通知 (スクロールでなくペイン幅拡大で対応するため) */
  onTabsOverflow?: (neededWidth: number) => void;
}

type Tab = 'info' | 'comments' | 'pastComments' | 'series' | 'related';

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
  autoNextRelated = false,
  onAutoNextRelatedChange,
  onRelatedLoaded,
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
  const [pastDateFrom, setPastDateFrom] = useState('');
  const [pastTimeFrom, setPastTimeFrom] = useState('00:00');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- タブ切替では発火させず、動画のシリーズ有無が変わった時だけ判定する
  }, [watch?.series]);

  // videoId不明、またはローカル再生(連続再生OFF時)に切り替わった時、関連動画タブを 'info' に戻す。
  // 連続再生ON中はDL済み動画を経由してもタブ・取得を止めない (でないと2本目以降で連続再生が止まる)
  useEffect(() => {
    if ((!watch?.videoId || (isLocal && !autoNextRelated)) && tab === 'related') setTab('info');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- タブ切替では発火させず、動画・再生元・連続再生設定が変わった時だけ判定する
  }, [watch?.videoId, isLocal, autoNextRelated]);

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

  /** From 指定日時を Unix 秒に変換 (未指定なら 0) */
  const getFromUnixSec = useCallback((): number => {
    if (!pastDateFrom) return 0;
    try {
      return Math.floor(new Date(`${pastDateFrom}T${pastTimeFrom}`).getTime() / 1000);
    } catch {
      return 0;
    }
  }, [pastDateFrom, pastTimeFrom]);

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
        whenSec,
        getFromUnixSec()
      );
      loadPastCommentsChunked(cs);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
    }
  }, [localCommentXmlPath, getWhenUnixSec, getFromUnixSec, loadPastCommentsChunked]);

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
      const fromSec = getFromUnixSec();
      const filtered = fromSec ? cs.filter((c) => c.date >= fromSec) : cs;
      loadPastCommentsChunked(filtered);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
      setPastProgressMsg(null);
    }
  }, [videoId, getWhenUnixSec, getFromUnixSec, pastFetchMaxCount, loadPastCommentsChunked]);

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
          {watch?.videoId && (!isLocal || autoNextRelated) && (
            <TabButton
              label="関連動画"
              active={tab === 'related'}
              onClick={() => setTab('related')}
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
        ) : tab === 'related' && watch?.videoId && (!isLocal || autoNextRelated) ? (
          <RelatedTabContent
            videoId={watch.videoId}
            autoNext={autoNextRelated}
            onAutoNextChange={onAutoNextRelatedChange}
            onLoaded={onRelatedLoaded}
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
          <PastCommentsPanel
            pastDateFrom={pastDateFrom}
            onPastDateFromChange={setPastDateFrom}
            pastTimeFrom={pastTimeFrom}
            onPastTimeFromChange={setPastTimeFrom}
            pastDate={pastDate}
            onPastDateChange={setPastDate}
            pastTime={pastTime}
            onPastTimeChange={setPastTime}
            onResetDate={handleResetDate}
            localCommentXmlPath={localCommentXmlPath}
            videoId={videoId}
            pastLoading={pastLoading}
            pastFetchMaxCount={pastFetchMaxCount}
            onPastFetchMaxCountChange={setPastFetchMaxCount}
            onFilterFromLocal={handleFilterFromLocal}
            onFetchFromNico={handleFetchPastCommentsFromNico}
            pastError={pastError}
            pastProgressMsg={pastProgressMsg}
            pastComments={pastComments}
            ngList={ngList}
            onSeek={handleSeek}
            currentTimeMs={currentTimeMs}
            onAddNg={handleAddNg}
            onRemoveNg={handleRemoveNg}
          />
        )}
      </div>
    </div>
  );
}
