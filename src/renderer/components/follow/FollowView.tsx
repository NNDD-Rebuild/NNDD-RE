import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { SearchResultItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { VideoCard } from '../common/VideoCard';
import type { VideoCardData } from '../common/VideoCard';
import { useAppStore } from '@renderer/store/useAppStore';

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
  const allFetchingRef = useRef(false);
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
  const userFetchingRef = useRef(false);

  // --- フォローユーザー state ---
  const [followUsers, setFollowUsers] = useState<FollowingUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  // --- UI state ---
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const globalMode = useAppStore((s) => s.contentViewMode);
  const showToast = useAppStore((s) => s.showToast);
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>(globalMode);
  const LIMIT = 32;

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  // hasNext 計算
  const userHasNext = userApiPage * LIMIT < userTotalCount;

  // --- ライブラリ済みチェック ---
  const checkDownloaded = useCallback((items: SearchResultItem[]): void => {
    const ids = items.map((i) => i.videoId);
    window.nndd
      .invoke<string[]>(window.nndd.channels.LIBRARY_CHECK_BATCH, ids)
      .then((dl) => setDownloadedIds(new Set(dl)))
      .catch(() => {});
  }, []);

  // --- 全体フィード取得 ---
  const fetchAll = useCallback(async (untilId: string | null): Promise<void> => {
    if (allFetchingRef.current) return;
    allFetchingRef.current = true;
    setAllLoading(true);
    setAllError(null);
    try {
      const r = await apiFetchAllFeed(LIMIT, untilId ?? undefined);
      setAllItems(r.items);
      setAllHasNext(r.hasNext);
      allNextCursorRef.current = r.nextCursor;
      checkDownloaded(r.items);
    } catch (e) {
      setAllError(e instanceof Error ? e.message : String(e));
    } finally {
      setAllLoading(false);
      allFetchingRef.current = false;
    }
  }, [checkDownloaded]);

  // マウント時に自動読み込み
  useEffect(() => {
    void fetchAll(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 選択ユーザーフィード取得 (page=1始まり) ---
  const fetchUserPage = async (user: FollowingUser, page: number): Promise<void> => {
    if (userFetchingRef.current) return;
    userFetchingRef.current = true;
    setUserLoading(true);
    setUserError(null);
    try {
      const r = await apiFetchUserFeed(LIMIT, user, page);
      setUserItems(r.items);
      setUserTotalCount(r.totalCount ?? 0);
      setUserApiPage(page);
      checkDownloaded(r.items);
    } catch (e) {
      setUserError(e instanceof Error ? e.message : String(e));
    } finally {
      setUserLoading(false);
      userFetchingRef.current = false;
    }
  };

  // selectedUserId 変化時: ユーザーフィードをリセットして page=1 取得
  useEffect(() => {
    if (!selectedUserId) {
      setUserItems([]);
      setUserTotalCount(0);
      setUserApiPage(1);
      setUserError(null);
      return;
    }
    const user = followUsers.find((u) => u.id === selectedUserId);
    if (!user) return;
    void fetchUserPage(user, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  // --- Next/Prev ---
  const handleNext = async (): Promise<void> => {
    if (selectedUserId !== null) {
      if (!userHasNext || userLoading) return;
      const user = followUsers.find((u) => u.id === selectedUserId);
      if (!user) return;
      await fetchUserPage(user, userApiPage + 1);
    } else {
      const cursor = allNextCursorRef.current;
      if (!allHasNext || allLoading || !cursor) return;
      const newIdx = allPageIdx + 1;
      const newStack = allCursorStackRef.current.slice(0, allPageIdx + 1);
      newStack.push(cursor);
      allCursorStackRef.current = newStack;
      setAllPageIdx(newIdx);
      await fetchAll(cursor);
    }
  };

  const handlePrev = (): void => {
    if (selectedUserId !== null) {
      if (userApiPage <= 1 || userLoading) return;
      const user = followUsers.find((u) => u.id === selectedUserId);
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
    allCursorStackRef.current = [null];
    allNextCursorRef.current = null;
    setAllPageIdx(0);
    void fetchAll(null);
  }, [fetchAll]);

  // --- フォローユーザー取得 (初回のみ) ---
  useEffect(() => {
    if (followUsers.length > 0 || usersLoading) return;
    setUsersLoading(true);
    setUsersError(null);
    window.nndd.invoke<FollowingUser[]>(IpcChannel.FOLLOW_USERS)
      .then((users) => setFollowUsers(users))
      .catch((e: unknown) => setUsersError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUsersLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const handleDownload = (videoId: string): void => {
    const commentOnly = downloadedIds.has(videoId);
    window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId, commentOnly });
    showToast(commentOnly ? 'コメントのみDLリストに追加しました' : 'DLリストに追加しました');
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/watch/${videoId}`);
  };
  const handleUserPage = (userId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/user/${userId}`);
  };

  const headerLabel = isUserMode
    ? `${sortedFollowUsers.find((u) => u.id === selectedUserId)?.nickname ?? selectedUserId} の動画`
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
            onClick={() => setSelectedUserId(null)}
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
              onClick={() => setSelectedUserId(null)}
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

        {/* ページネーション固定バー */}
        {(displayItems.length > 0 || displayLoading) && (
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
        <div className="flex-1 overflow-auto p-3">
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
            displayMode === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                {displayItems.map((r) => (
                  <VideoCard
                    key={r.videoId}
                    data={toCardData(r)}
                    onPlay={handlePlay}
                    onDownload={handleDownload}
                    onNiconico={handleNiconico}
                    onUserPage={handleUserPage}
                    onPlayAudioOnly={handlePlayAudioOnly}
                    isDownloaded={downloadedIds.has(r.videoId)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {displayItems.map((r) => (
                  <VideoCard
                    key={r.videoId}
                    data={toCardData(r)}
                    layout="list"
                    onPlay={handlePlay}
                    onDownload={handleDownload}
                    onNiconico={handleNiconico}
                    onUserPage={handleUserPage}
                    onPlayAudioOnly={handlePlayAudioOnly}
                    isDownloaded={downloadedIds.has(r.videoId)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
