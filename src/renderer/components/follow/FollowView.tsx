import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { SearchResultItem, UserMylistSummary, UserSeriesSummary } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { VideoCard } from '../common/VideoCard';
import type { VideoCardData } from '../common/VideoCard';
import { VirtualizedItemList } from '../common/VirtualizedItemList';
import { useAppStore } from '@renderer/store/useAppStore';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { userUrl, watchUrl } from '@shared/utils/nicoUrl';
import { useWatchedIds } from '@renderer/hooks/useWatchedIds';
import { useLibraryCheck } from '@renderer/hooks/useLibraryCheck';
import type { DownloadKind } from '@shared/types/download';
import { enqueueDownload } from '../../util/enqueueDownload';

interface FeedResult {
  items: SearchResultItem[];
  hasNext: boolean;
  nextCursor: string | null;
  totalCount?: number;
}

interface FollowingUser {
  id: string;
  nickname: string;
  iconUrl: string;
}

/** SearchResultItem → VideoCardData */
function toCardData(it: SearchResultItem): VideoCardData {
  return {
    videoId: it.videoId,
    title: it.title,
    thumbnailUrl: it.thumbnailUrl,
    length: it.length,
    viewCount: it.viewCount,
    commentCount: it.commentCount,
    mylistCount: it.mylistCount,
    likeCount: it.likeCount,
    registeredAt: it.registeredAt,
    authorIconUrl: it.author?.iconUrl,
    authorId: it.author?.id,
    authorNickname: it.author?.nickname,
    isChannelVideo: it.isChannelVideo,
  };
}

/** ユーザーモード用: page 番号 (1始まり) で取得 */
async function apiFetchUserFeed(
  limit: number,
  user: FollowingUser,
  pageNum: number
): Promise<FeedResult> {
  const r = await window.nndd.invoke<FeedResult>(
    IpcChannel.FOLLOW_FEED,
    {
      limit,
      pageNum,
      userId: user.id,
      userNickname: user.nickname,
      userIconUrl: user.iconUrl,
    }
  );
  return {
    ...r,
    items: r.items.map((it) => ({
      ...it,
      registeredAt: it.registeredAt ? new Date(it.registeredAt) : it.registeredAt,
    })),
  };
}

/** 全体フィード用: 日付カーソルで取得 */
async function apiFetchAllFeed(limit: number, untilId?: string): Promise<FeedResult> {
  const r = await window.nndd.invoke<FeedResult>(
    IpcChannel.FOLLOW_FEED,
    { limit, untilId }
  );
  return {
    ...r,
    items: r.items.map((it) => ({
      ...it,
      registeredAt: it.registeredAt ? new Date(it.registeredAt) : it.registeredAt,
    })),
  };
}

/**
 * フォロー中タブ。
 * 左ペイン: フォローユーザーリスト (選択で右ペインをそのユーザーの動画に絞り込み)
 * 右ペイン: フォロー中の新着動画 / 選択ユーザーの動画
 */
export function FollowView(): JSX.Element {
  // --- 全体フィード state (カーソルページ) ---
  const [allItems, setAllItems] = useState<SearchResultItem[]>([]);
  const [allHasNext, setAllHasNext] = useState(false);
  const [allPageIdx, setAllPageIdx] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  /** 全体フィード取得の連番。最後に投げた取得の結果だけを反映する */
  const allSeqRef = useRef(0);
  /** 各ページの開始カーソル (prev戻り用) */
  const allCursorStackRef = useRef<(string | null)[]>([null]);
  /** 現在ページの nextCursor */
  const allNextCursorRef = useRef<string | null>(null);

  // --- 選択ユーザーフィード state (page番号ページ) ---
  const [userItems, setUserItems] = useState<SearchResultItem[]>([]);
  const [userTotalCount, setUserTotalCount] = useState(0);
  /** 現在表示中の API page (1始まり) */
  const [userApiPage, setUserApiPage] = useState(1);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  /** 選択ユーザーフィード取得の連番。最後に投げた取得の結果だけを反映する */
  const userSeqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- フォローユーザー state ---
  const [followUsers, setFollowUsers] = useState<FollowingUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  // --- UI state ---
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  /** フォロー外ユーザーの一時表示用 (pendingFollowUser経由)。followUsersには追加しない */
  const [extraUser, setExtraUser] = useState<FollowingUser | null>(null);
  const { downloadedIds, checkDownloaded } = useLibraryCheck();
  const globalMode = useAppStore((s) => s.contentViewMode);
  const showToast = useAppStore((s) => s.showToast);
  const pendingFollowUser = useAppStore((s) => s.pendingFollowUser);
  const setPendingFollowUser = useAppStore((s) => s.setPendingFollowUser);
  const setPendingMylistId = useAppStore((s) => s.setPendingMylistId);
  const setPendingSeriesId = useAppStore((s) => s.setPendingSeriesId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setPendingChannelId = useAppStore((s) => s.setPendingChannelId);
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>(globalMode);
  const LIMIT = 32;

  // --- 選択中ユーザーのサブタブ (投稿動画/マイリスト/シリーズ) ---
  const [userSubTab, setUserSubTab] = useState<'videos' | 'mylists' | 'series'>('videos');
  const [userMylists, setUserMylists] = useState<UserMylistSummary[]>([]);
  const [userSeries, setUserSeries] = useState<UserSeriesSummary[]>([]);
  const [subTabLoading, setSubTabLoading] = useState(false);
  const [subTabError, setSubTabError] = useState<string | null>(null);
  /** サブタブ一覧取得の連番。読込中表示とエラーは最後に投げた取得のものだけを反映する */
  const subTabSeqRef = useRef(0);
  /** 非同期取得の完了時点で選択中のユーザーを判定するための参照 */
  const selectedUserIdRef = useRef<string | null>(null);
  selectedUserIdRef.current = selectedUserId;

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  // hasNext 計算
  const userHasNext = userApiPage * LIMIT < userTotalCount;

  // --- 全体フィード取得 ---
  // 取得中に再度呼ばれた場合 (取得中のログイン状態確定など) は新しい取得を優先し、古い取得の結果は捨てる。
  // 戻り値は結果を反映したか (追い越された / 失敗なら false)。先頭取得の反映時はページ位置も先頭に戻す
  const fetchAll = useCallback(async (untilId: string | null): Promise<boolean> => {
    const seq = ++allSeqRef.current;
    setAllLoading(true);
    setAllError(null);
    try {
      const r = await apiFetchAllFeed(LIMIT, untilId ?? undefined);
      if (seq !== allSeqRef.current) return false;
      setAllItems(r.items);
      setAllHasNext(r.hasNext);
      allNextCursorRef.current = r.nextCursor;
      if (untilId === null) {
        allCursorStackRef.current = [null];
        setAllPageIdx(0);
      }
      void checkDownloaded(r.items.map((i) => i.videoId));
      return true;
    } catch (e) {
      if (seq === allSeqRef.current) setAllError(toUserFriendlyErrorMessage(e));
      return false;
    } finally {
      if (seq === allSeqRef.current) {
        setAllLoading(false);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      }
    }
  }, [checkDownloaded]);

  // マウント時 + ログイン状態変化時に自動読み込み
  useEffect(() => {
    void fetchAll(null);
  }, [isLoggedIn, fetchAll]);

  // --- 選択ユーザーフィード取得 (page=1始まり) ---
  // 取得中にユーザーを切り替えた場合は新しいユーザーの取得を優先し、前のユーザーの結果は捨てる
  const fetchUserPage = async (user: FollowingUser, page: number): Promise<void> => {
    const seq = ++userSeqRef.current;
    setUserLoading(true);
    setUserError(null);
    try {
      const r = await apiFetchUserFeed(LIMIT, user, page);
      if (seq !== userSeqRef.current) return;
      setUserItems(r.items);
      setUserTotalCount(r.totalCount ?? 0);
      setUserApiPage(page);
      void checkDownloaded(r.items.map((i) => i.videoId));
    } catch (e) {
      if (seq === userSeqRef.current) setUserError(toUserFriendlyErrorMessage(e));
    } finally {
      if (seq === userSeqRef.current) {
        setUserLoading(false);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      }
    }
  };

  /** followUsers と extraUser (一時フォロー外ユーザー) の両方から id でユーザーを解決 */
  const resolveUser = useCallback(
    (id: string | null): FollowingUser | undefined =>
      id ? (followUsers.find((u) => u.id === id) ?? (extraUser?.id === id ? extraUser : undefined)) : undefined,
    [followUsers, extraUser]
  );

  // プレイヤーからのユーザー指定ナビゲーション: フォロー外でも一時的に絞り込み表示
  useEffect(() => {
    if (!pendingFollowUser) return;
    const user = pendingFollowUser;
    setPendingFollowUser(null);
    setExtraUser(user);
    setSelectedUserId(user.id);
  }, [pendingFollowUser, setPendingFollowUser]);

  // selectedUserId 変化時: ユーザーフィードをリセットして page=1 取得
  useEffect(() => {
    setUserSubTab('videos');
    setUserMylists([]);
    setUserSeries([]);
    setSubTabError(null);
    if (!selectedUserId) {
      // 取得中の前ユーザーの結果が、クリア後の一覧に書き戻されないよう無効化する
      ++userSeqRef.current;
      setUserLoading(false);
      setUserItems([]);
      setUserTotalCount(0);
      setUserApiPage(1);
      setUserError(null);
      return;
    }
    const user = resolveUser(selectedUserId);
    if (!user) return;
    void fetchUserPage(user, 1);
  // isLoggedIn 確定前に空取得で終わった場合、確定後に再取得するため依存に含める
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveUser はフォロー一覧の更新で変わるが、それでは再取得しない
  }, [selectedUserId, isLoggedIn]);

  // userSubTab 変化時: マイリスト/シリーズ一覧を取得
  useEffect(() => {
    if (!selectedUserId || userSubTab === 'videos') return;
    if (userSubTab === 'mylists' && userMylists.length > 0) return;
    if (userSubTab === 'series' && userSeries.length > 0) return;
    setSubTabLoading(true);
    setSubTabError(null);
    // 取得中にユーザーを切り替えた場合、前のユーザーの一覧を書き込まない
    // (書き込むと新しいユーザーで件数 > 0 と判定され、再取得されずに前のユーザーの一覧が出る)
    const seq = ++subTabSeqRef.current;
    const userId = selectedUserId;
    const channel = userSubTab === 'mylists'
      ? window.nndd.channels.USER_MYLISTS_FETCH
      : window.nndd.channels.USER_SERIES_FETCH;
    window.nndd.invoke<UserMylistSummary[] | UserSeriesSummary[]>(channel, userId)
      .then((list) => {
        if (selectedUserIdRef.current !== userId) return;
        if (userSubTab === 'mylists') setUserMylists(list as UserMylistSummary[]);
        else setUserSeries(list as UserSeriesSummary[]);
      })
      .catch((e: unknown) => {
        if (seq === subTabSeqRef.current && selectedUserIdRef.current === userId) {
          setSubTabError(toUserFriendlyErrorMessage(e));
        }
      })
      .finally(() => {
        if (seq === subTabSeqRef.current) setSubTabLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 取得済み一覧の件数変化では再取得しない
  }, [selectedUserId, userSubTab]);

  // --- Next/Prev ---
  const handleNext = async (): Promise<void> => {
    if (selectedUserId !== null) {
      if (!userHasNext || userLoading) return;
      const user = resolveUser(selectedUserId);
      if (!user) return;
      await fetchUserPage(user, userApiPage + 1);
    } else {
      const cursor = allNextCursorRef.current;
      if (!allHasNext || allLoading || !cursor) return;
      // ページ位置は取得が反映されてから進める (fetchAll(null) に追い越された結果でずらさない)
      if (!(await fetchAll(cursor))) return;
      const newStack = allCursorStackRef.current.slice(0, allPageIdx + 1);
      newStack.push(cursor);
      allCursorStackRef.current = newStack;
      setAllPageIdx(allPageIdx + 1);
    }
  };

  const handlePrev = (): void => {
    if (selectedUserId !== null) {
      if (userApiPage <= 1 || userLoading) return;
      const user = resolveUser(selectedUserId);
      if (user) void fetchUserPage(user, userApiPage - 1);
    } else {
      if (allPageIdx <= 0) return;
      const newIdx = allPageIdx - 1;
      const cursor = allCursorStackRef.current[newIdx] ?? null;
      setAllPageIdx(newIdx);
      void fetchAll(cursor);
    }
  };

  const handleReload = useCallback((): void => {
    setSelectedUserId(null);
    setExtraUser(null);
    allCursorStackRef.current = [null];
    allNextCursorRef.current = null;
    setAllPageIdx(0);
    void fetchAll(null);
  }, [fetchAll]);

  // --- フォローユーザー取得 (isLoggedIn確定前に空取得で終わった場合、確定後に再取得) ---
  useEffect(() => {
    if (followUsers.length > 0 || usersLoading) return;
    setUsersLoading(true);
    setUsersError(null);
    window.nndd.invoke<FollowingUser[]>(IpcChannel.FOLLOW_USERS)
      .then((users) => setFollowUsers(users))
      .catch((e: unknown) => setUsersError(toUserFriendlyErrorMessage(e)))
      .finally(() => setUsersLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 一覧・読込中フラグの変化では発火させず、ログイン状態の変化時だけ取得する
  }, [isLoggedIn]);

  // --- ユーザーを最新投稿順にソート ---
  const sortedFollowUsers = useMemo((): FollowingUser[] => {
    if (followUsers.length === 0) return followUsers;
    const latestMap = new Map<string, number>();
    for (const it of allItems) {
      if (it.author?.id) {
        const t = it.registeredAt instanceof Date ? it.registeredAt.getTime() : 0;
        const prev = latestMap.get(it.author.id) ?? 0;
        if (t > prev) latestMap.set(it.author.id, t);
      }
    }
    return [...followUsers].sort((a, b) => (latestMap.get(b.id) ?? 0) - (latestMap.get(a.id) ?? 0));
  }, [followUsers, allItems]);

  // --- 表示用アイテム ---
  const isUserMode = selectedUserId !== null;
  const displayItems = isUserMode ? userItems : allItems;
  const displayLoading = isUserMode ? userLoading : allLoading;
  const displayError = isUserMode ? userError : allError;
  const displayVideoIds = useMemo(() => displayItems.map((r) => r.videoId), [displayItems]);
  const watchedIds = useWatchedIds(displayVideoIds);
  const displayHasNext = isUserMode ? userHasNext : allHasNext;
  // 表示用ページ番号 (0始まり)
  const displayPageIdx = isUserMode ? userApiPage - 1 : allPageIdx;
  const displayHasPrev = isUserMode ? userApiPage > 1 : allPageIdx > 0;

  // --- ハンドラ ---
  const handlePlay = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId });
  };
  const handlePlayAudioOnly = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId, audioOnly: true });
  };
  const handleDownload = (videoId: string, kind?: DownloadKind): void => {
    showToast(enqueueDownload(videoId, downloadedIds.has(videoId), kind));
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, watchUrl(videoId));
  };
  const handleUserPage = (userId: string): void => {
    if (userId.startsWith('ch')) {
      setPendingChannelId(userId);
      setActiveTab('mylist');
      return;
    }
    const known = resolveUser(userId);
    const author = [...userItems, ...allItems].find((r) => r.author?.id === userId)?.author;
    setPendingFollowUser({
      id: userId,
      nickname: known?.nickname ?? author?.nickname ?? '',
      iconUrl: known?.iconUrl ?? author?.iconUrl ?? '',
    });
  };
  const handleOpenMylist = (id: string): void => {
    setPendingMylistId(id);
    setActiveTab('mylist');
  };
  const handleOpenSeries = (id: string): void => {
    setPendingSeriesId(id);
    setActiveTab('mylist');
  };

  const headerLabel = isUserMode
    ? `${resolveUser(selectedUserId)?.nickname ?? selectedUserId} の動画`
    : 'フォロー中の新着動画';

  return (
    <div className="h-full flex">
      {/* 左ペイン: フォローユーザーリスト */}
      <aside className="w-48 border-r border-nndd-border bg-nndd-panel flex flex-col shrink-0">
        <div className="px-2 py-1.5 border-b border-nndd-border text-xs font-bold text-nndd-subtext shrink-0">
          フォロー中ユーザー
        </div>
        <div className="flex-1 overflow-auto p-1">
          {/* すべて */}
          <button
            onClick={() => { setSelectedUserId(null); setExtraUser(null); }}
            className={[
              'block w-full text-left px-2 py-1 rounded text-xs mb-0.5',
              !isUserMode
                ? 'bg-nndd-accent text-white'
                : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text'
            ].join(' ')}
          >
            すべて
          </button>
          {usersLoading && (
            <div className="text-xs text-nndd-subtext px-2 py-1">読込中…</div>
          )}
          {usersError && (
            <div className="text-xs text-red-500 dark:text-red-400 px-2 py-1 break-all">{usersError}</div>
          )}
          {sortedFollowUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(u.id === selectedUserId ? null : u.id)}
              className={[
                'flex items-center gap-1.5 w-full text-left px-2 py-1 rounded text-xs',
                selectedUserId === u.id
                  ? 'bg-nndd-accent text-white'
                  : 'hover:bg-nndd-border'
              ].join(' ')}
              title={u.nickname}
            >
              {u.iconUrl ? (
                <img
                  src={u.iconUrl}
                  alt=""
                  className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-nndd-border flex-shrink-0" />
              )}
              <span className="truncate">{u.nickname}</span>
            </button>
          ))}
          {!usersLoading && followUsers.length === 0 && !usersError && (
            <div className="text-xs text-nndd-subtext px-2 py-1">ユーザーなし</div>
          )}
        </div>
      </aside>

      {/* 右ペイン: メイン動画エリア */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ツールバー */}
        <div className="shrink-0 px-3 py-2 border-b border-nndd-border bg-nndd-panel flex items-center gap-2">
          <span className="text-sm font-bold flex-1 truncate">{headerLabel}</span>
          {isUserMode && (
            <span className="text-xs text-nndd-subtext shrink-0">
              {userTotalCount > 0 ? `全${userTotalCount}件` : ''}
            </span>
          )}
          {isUserMode && (
            <button
              onClick={() => { setSelectedUserId(null); setExtraUser(null); }}
              className="text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
            >
              ✕ 解除
            </button>
          )}
          <button
            onClick={handleReload}
            disabled={allLoading}
            className="text-xs px-2 py-1 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white disabled:opacity-50"
            title="再読み込み"
          >
            {allLoading ? '読込中…' : '↺'}
          </button>
          <div className="flex border border-nndd-border rounded overflow-hidden">
            <button
              onClick={() => setDisplayMode('grid')}
              className={`text-xs px-2 py-1 ${displayMode === 'grid' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
              title="グリッド表示"
            >⊞</button>
            <button
              onClick={() => setDisplayMode('list')}
              className={`text-xs px-2 py-1 ${displayMode === 'list' ? 'bg-nndd-accent text-white' : 'hover:bg-nndd-border'}`}
              title="リスト表示"
            >☰</button>
          </div>
        </div>

        {/* サブタブ (選択中ユーザー: 投稿動画/マイリスト/シリーズ) */}
        {isUserMode && (
          <div className="shrink-0 flex gap-1 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel">
            {([
              { id: 'videos', label: '投稿動画' },
              { id: 'mylists', label: 'マイリスト' },
              { id: 'series', label: 'シリーズ' },
            ] as const).map((t) => (
              <button
                key={t.id}
                onClick={() => setUserSubTab(t.id)}
                className={[
                  'text-xs px-3 py-1 rounded',
                  userSubTab === t.id ? 'bg-nndd-accent text-white' : 'bg-nndd-border hover:bg-nndd-accent/70'
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, userUrl(selectedUserId))}
              className="text-xs px-3 py-1 rounded bg-nndd-border hover:bg-nndd-accent/70"
              title="ニコニコ動画のユーザーページを外部ブラウザで開く"
            >
              ニコニコで開く
            </button>
          </div>
        )}

        {/* ページネーション固定バー */}
        {userSubTab === 'videos' && (displayItems.length > 0 || displayLoading) && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs">
            <span className="text-nndd-subtext">
              {isUserMode && userTotalCount > 0
                ? `${userTotalCount.toLocaleString()} 件中 ${(userApiPage - 1) * LIMIT + 1}–${Math.min(userApiPage * LIMIT, userTotalCount)} 件表示`
                : displayLoading ? '読込中…' : `ページ ${displayPageIdx + 1}`}
            </span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={handlePrev}
                disabled={!displayHasPrev || displayLoading}
                className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white disabled:opacity-50"
              >◀ 前</button>
              <span className="text-nndd-subtext px-2">{displayPageIdx + 1}</span>
              <button
                onClick={() => void handleNext()}
                disabled={!displayHasNext || displayLoading}
                className="px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent hover:text-white disabled:opacity-50"
              >次 ▶</button>
            </div>
          </div>
        )}

        {/* コンテンツ */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-3">
          {userSubTab !== 'videos' ? (
            <>
              {subTabError && (
                <div className="text-red-500 dark:text-red-400 text-sm mb-3 whitespace-pre-wrap">
                  ⚠ {subTabError}
                </div>
              )}
              {subTabLoading && (
                <div className="text-nndd-subtext text-sm">読込中…</div>
              )}
              {!subTabLoading && userSubTab === 'mylists' && userMylists.length === 0 && !subTabError && (
                <div className="text-nndd-subtext text-sm">公開マイリストが見つかりませんでした。</div>
              )}
              {!subTabLoading && userSubTab === 'series' && userSeries.length === 0 && !subTabError && (
                <div className="text-nndd-subtext text-sm">公開シリーズが見つかりませんでした。</div>
              )}
              {userSubTab === 'mylists' && userMylists.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                  {userMylists.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleOpenMylist(m.id)}
                      className="text-left p-2 border border-nndd-border rounded hover:bg-nndd-border/50"
                    >
                      <div className="text-sm font-medium line-clamp-2">{m.name}</div>
                      <div className="text-xs text-nndd-subtext mt-1">{m.itemsCount} 件</div>
                    </button>
                  ))}
                </div>
              )}
              {userSubTab === 'series' && userSeries.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                  {userSeries.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleOpenSeries(s.id)}
                      className="text-left border border-nndd-border rounded overflow-hidden hover:bg-nndd-border/50"
                    >
                      {s.thumbnailUrl && (
                        <img src={s.thumbnailUrl} alt="" className="w-full aspect-video object-cover" loading="lazy" />
                      )}
                      <div className="p-2">
                        <div className="text-sm font-medium line-clamp-2">{s.title}</div>
                        <div className="text-xs text-nndd-subtext mt-1">{s.itemsCount} 件</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {displayError && (
                <div className="text-red-500 dark:text-red-400 text-sm mb-3 whitespace-pre-wrap">
                  ⚠ {displayError}
                  <span className="text-xs text-nndd-subtext ml-2">(ログイン確認)</span>
                </div>
              )}
              {displayLoading && displayItems.length === 0 && (
                <div className="text-nndd-subtext text-sm">読込中…</div>
              )}
              {!displayLoading && !isUserMode && allItems.length === 0 && !displayError && (
                <div className="text-nndd-subtext text-sm">
                  フォロー中ユーザーの新着動画が見つかりませんでした。
                  <br /><span className="text-xs">ニコニコ動画へのログインが必要です。</span>
                </div>
              )}
              {!displayLoading && isUserMode && userItems.length === 0 && !displayError && (
                <div className="text-nndd-subtext text-sm">動画が見つかりませんでした。</div>
              )}
              {displayItems.length > 0 && (
                <VirtualizedItemList
                  items={displayItems}
                  layout={displayMode}
                  scrollElementRef={scrollRef}
                  getKey={(r) => r.videoId}
                  renderItem={(r) => (
                    <VideoCard
                      data={isUserMode ? { ...toCardData(r), authorIconUrl: undefined, authorId: undefined, authorNickname: undefined } : toCardData(r)}
                      layout={displayMode === 'list' ? 'list' : undefined}
                      onPlay={handlePlay}
                      onDownload={handleDownload}
                      onNiconico={handleNiconico}
                      onUserPage={isUserMode ? undefined : handleUserPage}
                      onPlayAudioOnly={handlePlayAudioOnly}
                      isDownloaded={downloadedIds.has(r.videoId)}
                      isWatched={watchedIds.has(r.videoId)}
                    />
                  )}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
