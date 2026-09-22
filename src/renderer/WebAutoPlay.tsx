import { useEffect } from 'react';

/**
 * ブラウザ版プレイヤー専用の自動再生補助。
 *
 * 動画の読み込みが終わったら再生を試みる。ブラウザの自動再生制限 (音あり再生の拒否) で
 * 失敗した場合は、ミュートで再生を開始し、最初のユーザー操作でミュートを解除する。
 */
export function WebAutoPlay(): null {
  useEffect(() => {
    let unmuteVideo: HTMLVideoElement | null = null;

    const unmuteOnGesture = (): void => {
      if (unmuteVideo) {
        unmuteVideo.muted = false;
        unmuteVideo = null;
      }
      removeGestureListeners();
    };
    const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
    const removeGestureListeners = (): void => {
      for (const ev of gestureEvents) window.removeEventListener(ev, unmuteOnGesture, true);
    };

    // media イベントは bubble しないので capture で拾う (video 要素の差し替えにも追従できる)
    const onLoadedData = (e: Event): void => {
      const video = e.target;
      if (!(video instanceof HTMLVideoElement) || !video.paused) return;
      video.play().catch(() => {
        // 自動再生制限: ミュートなら通常許可される
        video.muted = true;
        video.play().then(
          () => {
            unmuteVideo = video;
            for (const ev of gestureEvents) window.addEventListener(ev, unmuteOnGesture, true);
          },
          () => {
            // ミュートでも拒否された場合は諦める (ユーザーが再生ボタンを押す)
            video.muted = false;
          }
        );
      });
    };

    document.addEventListener('loadeddata', onLoadedData, true);
    return () => {
      document.removeEventListener('loadeddata', onLoadedData, true);
      removeGestureListeners();
    };
  }, []);

  return null;
}
