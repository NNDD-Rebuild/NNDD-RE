import { useEffect, useMemo, useRef, useState } from 'react';
import type { RankingItem, RankingTermValue, RankingGenreInfo } from '@shared/types';
import { RANKING_GENRES, RANKING_TERMS } from '@shared/constants';
import { VideoCard } from '../common/VideoCard';
import { useAppStore } from '@renderer/store/useAppStore';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { useWatchedIds } from '@renderer/hooks/useWatchedIds';

const ALL_TAG = '';

/**
 * ランキングタブ。
 * ジャンル/サブカテゴリ(タグ)/集計期間選択 + グリッド/リスト表示切替
 */
export function RankingView(): JSX.Element {
  const [genres, setGenres] = useState<RankingGenreInfo[]>(RANKING_GENRES);
  const [genre, setGenre] = useState(RANKING_GENRES[0]?.id ?? 'e9uj2uks');
  const [term, setTerm] = useState<RankingTermValue>('24h');
  const [tag, setTag] = useState(ALL_TAG);
  const [trendTags, setTrendTags] = useState<string[]>([]);
  const [items, setItems] = useState<RankingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const videoIds = useMemo(() => items.map((i) => i.videoId), [items]);
  const watchedIds = useWatchedIds(videoIds);
  const globalMode = useAppStore((s) => s.contentViewMode);
  const showToast = useAppStore((s) => s.showToast);
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setPendingFollowUser = useAppStore((s) => s.setPendingFollowUser);
  const setPendingChannelId = useAppStore((s) => s.setPendingChannelId);
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>(globalMode);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentGenre = genres.find((g) => g.id === genre);

  // グローバル設定変更を即時反映
  useEffect(() => { setDisplayMode(globalMode); }, [globalMode]);

  // ジャンル一覧は起動時に本家サイトから動的取得 (失敗時は静的一覧のまま)
  useEffect(() => {
    window.nndd
      .invoke<RankingGenreInfo[]>(window.nndd.channels.RANKING_GENRES)
      .then((list) => {
        if (list && list.length > 0) setGenres(list);
      })
      .catch(() => {});
  }, []);

  const fetchRanking = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.nndd.invoke<{ items: RankingItem[]; trendTags: string[]; hasNext: boolean }>(
        window.nndd.channels.RANKING_FETCH,
        { genre, term, tag: tag || undefined }
      );
      const mapped = res.items.map((d) => ({ ...d, registeredAt: new Date(d.registeredAt) }));
      setItems(mapped);
      setTrendTags(res.trendTags ?? []);
      const ids = mapped.map((d) => d.videoId);
      window.nndd
        .invoke<string[]>(window.nndd.channels.LIBRARY_CHECK_BATCH, ids)
        .then((dl) => setDownloadedIds(new Set(dl)))
        .catch(() => {});
    } catch (e) {
      setError(toUserFriendlyErrorMessage(e));
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
    }
  };

  // ジャンルを切り替えたらサブカテゴリ選択はリセットする
  useEffect(() => {
    setTag(ALL_TAG);
    setTrendTags([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre]);

  useEffect(() => {
    fetchRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre, term, tag, isLoggedIn]);

  const handlePlay = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId });
  };
  const handleDownload = (videoId: string, audioOnly?: boolean): void => {
    const commentOnly = !audioOnly && downloadedIds.has(videoId);
    window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId, commentOnly, audioOnly });
    showToast(
      audioOnly ? '音声のみDLリストに追加しました'
        : commentOnly ? 'コメントのみDLリストに追加しました'
        : 'DLリストに追加しました'
    );
  };
  const handleNiconico = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, `https://www.nicovideo.jp/watch/${videoId}`);
  };
  const handlePlayAudioOnly = (videoId: string): void => {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId, audioOnly: true });
  };
  const handleUserPage = (userId: string): void => {
    if (userId.startsWith('ch')) {
      setPendingChannelId(userId);
      setActiveTab('mylist');
      return;
    }
    const author = items.find((r) => r.authorId === userId);
    setPendingFollowUser({
      id: userId,
      nickname: author?.authorNickname ?? '',
      iconUrl: author?.authorIconUrl ?? '',
    });
    setActiveTab('follow');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel flex-wrap">
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        >
          {genres.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        {currentGenre?.hasTags && (
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value={ALL_TAG}>すべて</option>
            {trendTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1">
          {RANKING_TERMS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTerm(t.id)}
              className={[
                'text-xs px-3 py-1 rounded',
                term === t.id ? 'bg-nndd-accent text-white' : 'bg-nndd-border hover:bg-nndd-accent/70'
              ].join(' ')}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button
          onClick={fetchRanking}
          disabled={loading}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
        >
          更新
        </button>
        <span className="text-xs text-nndd-subtext">{items.length} 件</span>
        <div className="flex border border-nndd-border rounded overflow-hidden ml-auto">
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

      <div ref={scrollRef} className="flex-1 overflow-auto p-3">
        {error && <div className="text-red-500 dark:text-red-400 text-sm mb-3">エラー: {error}</div>}
        {loading && <div className="text-nndd-subtext text-sm">読み込み中…</div>}
        {!loading && items.length === 0 && !error && (
          <div className="text-nndd-subtext text-sm">ランキングが取得できませんでした。</div>
        )}
        {items.length > 0 && (
          displayMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {items.map((r) => (
                <VideoCard
                  key={r.videoId}
                  data={{
                    videoId: r.videoId,
                    title: r.title,
                    thumbnailUrl: r.thumbnailUrl,
                    length: r.length,
                    viewCount: r.viewCount,
                    commentCount: r.commentCount,
                    mylistCount: r.mylistCount,
                    likeCount: r.likeCount,
                    registeredAt: r.registeredAt,
                    rank: r.rank,
                    description: r.description,
                    isChannelVideo: r.isChannelVideo,
                    authorId: r.authorId,
                    authorNickname: r.authorNickname,
                    authorIconUrl: r.authorIconUrl,
                  }}
                  onPlay={handlePlay}
                  onDownload={handleDownload}
                  onNiconico={handleNiconico}
                  onPlayAudioOnly={handlePlayAudioOnly}
                  onUserPage={handleUserPage}
                  isDownloaded={downloadedIds.has(r.videoId)}
                  isWatched={watchedIds.has(r.videoId)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {items.map((r) => (
                <VideoCard
                  key={r.videoId}
                  layout="list"
                  data={{
                    videoId: r.videoId,
                    title: r.title,
                    thumbnailUrl: r.thumbnailUrl,
                    length: r.length,
                    viewCount: r.viewCount,
                    commentCount: r.commentCount,
                    mylistCount: r.mylistCount,
                    likeCount: r.likeCount,
                    registeredAt: r.registeredAt,
                    rank: r.rank,
                    description: r.description,
                    isChannelVideo: r.isChannelVideo,
                    authorId: r.authorId,
                    authorNickname: r.authorNickname,
                    authorIconUrl: r.authorIconUrl,
                  }}
                  onPlay={handlePlay}
                  onDownload={handleDownload}
                  onNiconico={handleNiconico}
                  onPlayAudioOnly={handlePlayAudioOnly}
                  onUserPage={handleUserPage}
                  isDownloaded={downloadedIds.has(r.videoId)}
                  isWatched={watchedIds.has(r.videoId)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
