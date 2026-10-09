import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { NNDDREComment, NicowariContent } from '@shared/types';
import { IpcChannel } from '@shared/types';
import {
  collectMarkers,
  parseNicoScript,
  resolveMarker,
  type NicoScriptCommand
} from '@shared/utils/nicoScript';

/** 命令が再生位置に達してから、この時間内なら実行する (シークで飛び越えた命令や、途中から再生した場合の過去の命令は実行しない) */
const TRIGGER_WINDOW_MS = 2000;

/**
 * 投稿者コメントのニコスクリプト: ＠ジャンプ (別動画 / #分:秒 / #ラベル) ・ ＠ジャンプマーカー ・ニワン語 (/jump /seek /addMarker)。
 * 命令のあるコメントの位置に再生が達したら一度実行する。後ろへシークして位置より前に戻れば再び実行される。
 * 半角・全角 @ 両対応。fork は 'owner' (ストリーミング) / '1' (ローカルXML) の両方を見る。
 * ＠デフォルトの色指定は描画側 (useCommentRenderSettings) で扱う。
 */
export function useJumpCommand({
  video,
  comments,
  isLocalRef,
  autoNextFolderRef,
  mode,
  onAskJump
}: {
  video: HTMLVideoElement | null;
  comments: NNDDREComment[];
  isLocalRef: MutableRefObject<boolean>;
  autoNextFolderRef: MutableRefObject<boolean>;
  mode: 'ask' | 'auto' | 'off';
  /** mode が 'ask' のとき、別動画へ移る前に呼ぶ (移るかどうかは呼び出し側が確認する) */
  onAskJump: (videoId: string, msg?: string) => void;
}): void {
  const onAskJumpRef = useRef(onAskJump);
  onAskJumpRef.current = onAskJump;

  useEffect(() => {
    if (!video || mode === 'off') return;
    const parsed = comments
      .filter((c) => c.fork === 'owner' || c.fork === '1')
      .map((c) => ({ c, cmd: parseNicoScript(c.text ?? '', c.mail ?? ''), vposMs: c.vposMs }));
    const markers = collectMarkers(parsed);
    const runnable = parsed.filter(
      (p): p is typeof p & { cmd: NicoScriptCommand } =>
        p.cmd !== null && (p.cmd.kind === 'jump' || p.cmd.kind === 'seek' || p.cmd.kind === 'seekMarker')
    );
    if (runnable.length === 0) return;

    const triggered = new Set<number>();
    const run = (cmd: NicoScriptCommand, nowMs: number): void => {
      if (cmd.kind === 'jump') {
        // フォルダ連続再生中は、次の動画へ進む流れを邪魔しない
        if (isLocalRef.current && autoNextFolderRef.current) return;
        if (mode === 'ask') onAskJumpRef.current(cmd.videoId, cmd.msg);
        else window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId: cmd.videoId, autoNext: true });
        return;
      }
      let sec: number | null = null;
      if (cmd.kind === 'seek') sec = cmd.sec;
      else if (cmd.kind === 'seekMarker') {
        const ms = resolveMarker(markers, cmd.marker, nowMs);
        sec = ms === null ? null : ms / 1000;
      }
      if (sec === null || !Number.isFinite(video.duration)) return;
      video.currentTime = Math.min(sec, video.duration);
    };

    const onTime = (): void => {
      const nowMs = video.currentTime * 1000;
      for (const { c, cmd } of runnable) {
        if (triggered.has(c.no) || nowMs < c.vposMs || nowMs - c.vposMs > TRIGGER_WINDOW_MS) continue;
        triggered.add(c.no);
        run(cmd, nowMs);
      }
    };
    // 命令の位置より前へ戻ったら、再び通過したときに実行できるようにする
    const onSeeked = (): void => {
      const nowMs = video.currentTime * 1000;
      for (const { c } of runnable) {
        if (c.vposMs > nowMs) triggered.delete(c.no);
      }
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [video, comments, mode]);
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
