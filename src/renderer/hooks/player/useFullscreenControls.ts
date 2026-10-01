import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * フルスクリーン状態の追跡と、操作バーの自動表示/非表示。
 * containerRef の要素上でマウスが動くと操作バーを表示し、2.5 秒後に隠す。
 */
export function useFullscreenControls({
  containerRef,
  video
}: {
  containerRef: RefObject<HTMLDivElement>;
  video: HTMLVideoElement | null;
}): {
  isFullscreen: boolean;
  showControls: boolean;
  toggleFullscreen: () => void;
  handleVideoTap: () => void;
} {
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const toggleFullscreen = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        ?.then(() => {
          // モバイル (縦持ち) でのフルスクリーンは横画面固定にする。
          // lock() は型定義に無い実験的APIのため any 経由で呼ぶ。
          // デスクトップや API 非対応環境では失敗するので無視する。
          (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
            .lock?.('landscape')
            .catch(() => {});
        })
        .catch(() => {});
    } else {
      screen.orientation?.unlock?.();
      document.exitFullscreen?.();
    }
  }, []);

  // フルスクリーン状態追跡 (DOM fullscreen + BrowserWindow fullscreen + niconico)
  useEffect(() => {
    const onFsChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    // BrowserWindow レベルのフルスクリーン (OS ボタン)
    const offWin = window.electron.ipcRenderer.on(
      'nndd:player:window:fullscreen',
      (_e, full: boolean) => setIsFullscreen(full)
    );
    // niconicoプレイヤー内フルスクリーン
    const offNico = window.electron.ipcRenderer.on(
      'nndd:player:niconico:fullscreen',
      (_e, full: boolean) => setIsFullscreen(full)
    );
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      offWin();
      offNico();
    };
  }, []);

  const showControlsTemporarily = useCallback((): void => {
    setShowControls(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 2500);
  }, []);

  /** スマホ: 操作バーが隠れている時のタップは表示だけ、表示中のタップで再生/一時停止を切り替える */
  const handleVideoTap = useCallback((): void => {
    const wasVisible = showControls;
    showControlsTemporarily();
    if (!wasVisible) return;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, [showControls, showControlsTemporarily, video]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (): void => showControlsTemporarily();
    const onLeave = (): void => {
      if (isFullscreen) setShowControls(false);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    // 初期はコントロール表示
    showControlsTemporarily();
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [isFullscreen, showControlsTemporarily]);

  return { isFullscreen, showControls, toggleFullscreen, handleVideoTap };
}
