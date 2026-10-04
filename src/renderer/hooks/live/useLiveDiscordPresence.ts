import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { LiveConnectionState, LiveProgramInfo } from '@shared/types';
import { IpcChannel } from '@shared/types';

export interface LiveDiscordPresenceOptions {
  program: LiveProgramInfo | null;
  state: LiveConnectionState;
  isTimeshift: boolean;
  /** 今映っている映像の vpos (1/100秒) を返す関数 */
  currentVposRef: MutableRefObject<() => number>;
}

/**
 * 視聴中の番組を Discord Rich Presence に送る。視聴中でなくなったらクリアする。
 */
export function useLiveDiscordPresence({ program, state, isTimeshift, currentVposRef }: LiveDiscordPresenceOptions): void {
  const discordSentRef = useRef(false);
  const activeProgramId = program?.programId;
  useEffect(() => {
    const info = program;
    if (!activeProgramId || !info || state !== 'watching') {
      if (discordSentRef.current) {
        discordSentRef.current = false;
        window.nndd.send(IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY);
      }
      return;
    }
    const durationSec = info.endTimeMs > info.beginTimeMs ? (info.endTimeMs - info.beginTimeMs) / 1000 : undefined;
    discordSentRef.current = true;
    if (isTimeshift) {
      // タイムシフトは録画なので、動画と同じく現在の再生位置から開始時刻を逆算する
      window.nndd.send(IpcChannel.DISCORD_RPC_SET_ACTIVITY, {
        kind: 'timeshift',
        videoId: activeProgramId,
        title: info.title,
        thumbnailUrl: info.thumbnailUrl || undefined,
        durationSec,
        startedAtMs: Date.now() - currentVposRef.current() * 10
      });
    } else {
      // 放送中は番組の開始からの経過時間を表示する
      window.nndd.send(IpcChannel.DISCORD_RPC_SET_ACTIVITY, {
        kind: 'live',
        videoId: activeProgramId,
        title: info.title,
        thumbnailUrl: info.thumbnailUrl || undefined,
        startedAtMs: info.beginTimeMs > 0 ? info.beginTimeMs : Date.now()
      });
    }
  }, [activeProgramId, program?.title, program?.thumbnailUrl, program?.beginTimeMs, state, isTimeshift]);

  // ウィンドウを閉じたときは main 側 (LivePlayerManager) でもクリアする。番組を切り替えずに終了する場合の保険
  useEffect(() => {
    return () => {
      if (discordSentRef.current) window.nndd.send(IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY);
    };
  }, []);
}
