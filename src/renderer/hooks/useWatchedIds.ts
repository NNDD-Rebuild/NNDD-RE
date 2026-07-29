import { useEffect, useState } from 'react';
import { useConfig } from './useConfig';

/**
 * アプリ内履歴 + ニコ動本家履歴 (WATCHED_CHECK_BATCH) をORで一括照合し、
 * 再生済みバッジ表示用の videoId 集合を返す。
 * 設定 (history.showWatchedBadge) がOFFの間は空集合を返す。
 */
export function useWatchedIds(videoIds: string[]): Set<string> {
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [showWatchedBadge] = useConfig<boolean>('history.showWatchedBadge', true);
  const key = videoIds.join(',');

  useEffect(() => {
    if (!showWatchedBadge || videoIds.length === 0) {
      setWatchedIds(new Set());
      return;
    }
    window.nndd
      .invoke<string[]>(window.nndd.channels.WATCHED_CHECK_BATCH, videoIds)
      .then((ids) => setWatchedIds(new Set(ids)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, showWatchedBadge]);

  return watchedIds;
}
