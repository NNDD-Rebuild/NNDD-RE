import { useEffect, type MutableRefObject } from 'react';
import { IpcChannel } from '@shared/types';
import type { PlayInfo } from './playerUtils';

/**
 * Discord Rich Presence: ニコニコ動画 (ストリーミング・ライブラリのDL済み・保存した生放送) の再生開始時に送信し、
 * ウィンドウを閉じたらクリアする。動画IDの無いローカルファイル・LANライブラリの再生では送信せず、
 * 直前の表示が残らないようクリアする。
 */
export function useDiscordPresence({
  video,
  src,
  playInfoRef
}: {
  video: HTMLVideoElement | null;
  src: string;
  playInfoRef: MutableRefObject<PlayInfo | null>;
}): void {
  // 再生開始時にPresence送信 (src切替のたびに最新化)
  useEffect(() => {
    if (!video) return;
    const sendActivity = (): void => {
      const info = playInfoRef.current;
      if (!info?.isNiconicoVideo) {
        window.nndd.send(IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY);
        return;
      }
      if (!info.videoId) return;
      window.nndd.send(IpcChannel.DISCORD_RPC_SET_ACTIVITY, {
        videoId: info.videoId,
        title: info.title,
        thumbnailUrl: info.discordThumbnailUrl || undefined,
        durationSec: video.duration || undefined,
        startedAtMs: Date.now() - video.currentTime * 1000
      });
    };
    video.addEventListener('play', sendActivity);
    // ローカル再生は VideoPlayer マウント直後に play() されるため、リスナー登録前に
    // play イベントが発火済みのことがある。既に再生中なら即送信する
    if (!video.paused) sendActivity();
    return () => video.removeEventListener('play', sendActivity);
  }, [video, src]);

  // ウィンドウを閉じたらPresenceをクリア
  useEffect(() => {
    return () => {
      window.nndd.send(IpcChannel.DISCORD_RPC_CLEAR_ACTIVITY);
    };
  }, []);
}
