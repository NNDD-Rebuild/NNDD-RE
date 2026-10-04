import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { NNDDREComment, NicowariContent } from '@shared/types';
import { IpcChannel } from '@shared/types';

/**
 * owner コメントの @ジャンプ / ＠ジャンプ: 指定 vpos に達したら別動画へジャンプ。
 * 半角・全角 @ 両対応。fork は 'owner' (ストリーミング) / '1' (ローカルXML) の両方を見る。
 */
export function useJumpCommand({
  video,
  comments,
  isLocalRef,
  autoNextFolderRef
}: {
  video: HTMLVideoElement | null;
  comments: NNDDREComment[];
  isLocalRef: MutableRefObject<boolean>;
  autoNextFolderRef: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    if (!video) return;
    const jumpComments = comments.filter(
      (c) =>
        (c.fork === 'owner' || c.fork === '1') &&
        /[＠@]ジャンプ/.test((c.mail ?? '') + ' ' + (c.text ?? ''))
    );
    if (jumpComments.length === 0) return;
    const triggered = new Set<number>();
    const onTime = (): void => {
      if (isLocalRef.current && autoNextFolderRef.current) return;
      const nowMs = video.currentTime * 1000;
      for (const c of jumpComments) {
        if (!triggered.has(c.no) && nowMs >= c.vposMs) {
          triggered.add(c.no);
          // text から @ジャンプ 部分を除去して動画ID抽出
          const rawText = (c.text ?? '').replace(/[＠@]ジャンプ\s*/g, '').trim();
          const m = rawText.match(/((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)/);
          const targetId = m ? m[1] : rawText;
          if (targetId) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId: targetId, autoNext: true });
          }
        }
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [video, comments]);
}

/**
 * owner コメントの ＠CM (ユーザーニコ割): 指定 vpos に達したらニコ割を動画上部に表示する。
 * 書式: ＠CM nm12345 [再生|停止]。「停止」ならニコ割の間は本編を止める (本家NNDD準拠)。
 * 時刻 (hhmm) 指定の時報型は本家同様に対象外。ニコ割SWFはローカル再生時のみ手元にある。
 *
 * @returns ニコ割の表示終了ハンドラ (「停止」で止めた本編を再開する)
 */
export function useNicowari({
  video,
  comments,
  nicowariFiles,
  setActiveNicowari,
  pausedByNicowariRef,
  videoElementRef
}: {
  video: HTMLVideoElement | null;
  comments: NNDDREComment[];
  nicowariFiles: string[];
  setActiveNicowari: Dispatch<SetStateAction<NicowariContent | null>>;
  pausedByNicowariRef: MutableRefObject<boolean>;
  videoElementRef: MutableRefObject<HTMLVideoElement | null>;
}): () => void {
  useEffect(() => {
    if (!video || nicowariFiles.length === 0) return;
    const cmComments = comments.filter(
      (c) => (c.fork === 'owner' || c.fork === '1') && /^[＠@][CＣ][MＭ]/.test(c.text ?? '')
    );
    if (cmComments.length === 0) return;
    const triggered = new Set<number>();
    let disposed = false;
    const onTime = (): void => {
      const nowMs = video.currentTime * 1000;
      for (const c of cmComments) {
        if (triggered.has(c.no) || nowMs < c.vposMs) continue;
        triggered.add(c.no);
        const text = c.text ?? '';
        const id = text.match(/(nm\d+)/i)?.[1];
        if (!id || /(nm\d+)[^\d].*\s(\d{4})/i.test(text)) continue;
        const file = nicowariFiles.find((f) => f.toLowerCase().includes(`[nicowari][${id.toLowerCase()}]`));
        if (!file) {
          console.warn('[Nicowari] ニコ割SWFがダウンロードされていません:', id);
          continue;
        }
        const stop = text.includes('停止');
        window.nndd
          .invoke<NicowariContent>(window.nndd.channels.LIBRARY_NICOWARI_READ, file)
          .then((content) => {
            if (disposed) return;
            if (stop && !video.paused) {
              video.pause();
              pausedByNicowariRef.current = true;
            }
            setActiveNicowari(content);
          })
          .catch((e) => console.warn('[Nicowari] 読み込み失敗:', file, e));
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => {
      disposed = true;
      video.removeEventListener('timeupdate', onTime);
    };
  }, [video, comments, nicowariFiles]);

  const endNicowari = useCallback((): void => {
    setActiveNicowari(null);
    if (pausedByNicowariRef.current) {
      pausedByNicowariRef.current = false;
      videoElementRef.current?.play().catch(() => {});
    }
  }, []);

  return endNicowari;
}
