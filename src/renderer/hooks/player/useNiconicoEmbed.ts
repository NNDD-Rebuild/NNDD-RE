import { useEffect, type MutableRefObject, type RefObject } from 'react';
import { IpcChannel } from '@shared/types';
import type { PlayInfo } from './playerUtils';

/**
 * niconico 公式プレイヤー埋め込みモード。
 * main 側で表示する埋め込みビューを、ラッパー要素の位置・サイズに追従させる。
 */
export function useNiconicoEmbed(
  niconicoMode: boolean,
  webviewWrapperRef: RefObject<HTMLDivElement>,
  playInfoRef: MutableRefObject<PlayInfo | null>
): void {
  useEffect(() => {
    if (!niconicoMode) {
      window.nndd.send(IpcChannel.PLAYER_NICONICO_DESTROY);
      return;
    }
    const el = webviewWrapperRef.current;
    if (!el) return;

    window.nndd.send(IpcChannel.PLAYER_NICONICO_INIT, {
      videoId: playInfoRef.current?.videoId ?? ''
    });

    const sendBounds = (): void => {
      const rect = el.getBoundingClientRect();
      window.nndd.send(IpcChannel.PLAYER_NICONICO_RESIZE, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    };
    sendBounds();
    const ro = new ResizeObserver(sendBounds);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.nndd.send(IpcChannel.PLAYER_NICONICO_DESTROY);
    };
  }, [niconicoMode]);
}
