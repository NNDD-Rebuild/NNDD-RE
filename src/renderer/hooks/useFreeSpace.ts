import { useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';

/** バイト数を GB 表記にする (小数2桁。元: 本家の「◯◯ GB空き」表示) */
export function formatFreeSpace(freeBytes: number): string {
  return `${(freeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB 空き`;
}

/**
 * 動画保存先ドライブの空き容量の表示文字列 (取得できなければ null)。
 * refreshKey が変わるたびに取り直す (DL 完了・ライブラリ更新後など)。
 */
export function useFreeSpace(refreshKey?: unknown): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.nndd
      .invoke<{ freeBytes: number; totalBytes: number } | null>(IpcChannel.SYS_GET_FREE_SPACE)
      .then((info) => {
        if (!cancelled) setText(info ? formatFreeSpace(info.freeBytes) : null);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return text;
}
