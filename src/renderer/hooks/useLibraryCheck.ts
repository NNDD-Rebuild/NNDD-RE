import { useCallback, useRef, useState } from 'react';

/**
 * 一覧系 View の DL 済み照合 (LIBRARY_CHECK_BATCH)。
 * checkDownloaded を呼ぶたびに世代を進め、後から呼ばれた照合がある場合は
 * 古い照合の結果で downloadedIds を上書きしない (一覧切替時に前の一覧の結果が混ざるのを防ぐ)。
 * 戻り値は照合結果 (失敗時は null)。世代が古くても結果自体は返す。
 */
export function useLibraryCheck(): {
  downloadedIds: Set<string>;
  checkDownloaded: (videoIds: string[]) => Promise<Set<string> | null>;
} {
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const genRef = useRef(0);

  const checkDownloaded = useCallback(async (videoIds: string[]): Promise<Set<string> | null> => {
    const gen = ++genRef.current;
    try {
      const dl = new Set(
        await window.nndd.invoke<string[]>(window.nndd.channels.LIBRARY_CHECK_BATCH, videoIds)
      );
      if (gen === genRef.current) setDownloadedIds(dl);
      return dl;
    } catch {
      return null;
    }
  }, []);

  return { downloadedIds, checkDownloaded };
}
