import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  togglePlay?: () => void;
  toggleMute?: () => void;
  toggleFullscreen?: () => void;
  toggleComments?: () => void;
  seek?: (deltaSec: number) => void;
  volumeUp?: () => void;
  volumeDown?: () => void;
  skipNext?: () => void;
  skipPrev?: () => void;
}

/**
 * 動画プレイヤー用のキーボードショートカット。
 *
 *  - Space: 再生/一時停止
 *  - F11 / F: フルスクリーン切替
 *  - M: ミュート
 *  - V: コメント表示切替
 *  - ← → : -5/+5秒
 *  - Shift + ← → : -10/+10秒
 *  - ↑ ↓: 音量+/-
 */
export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      // input要素フォーカス中は無効化
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlers.togglePlay?.();
          break;
        case 'KeyF':
        case 'F11':
          e.preventDefault();
          handlers.toggleFullscreen?.();
          break;
        case 'KeyM':
          e.preventDefault();
          handlers.toggleMute?.();
          break;
        case 'KeyV':
          e.preventDefault();
          handlers.toggleComments?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlers.seek?.(e.shiftKey ? -10 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handlers.seek?.(e.shiftKey ? 10 : 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          handlers.volumeUp?.();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handlers.volumeDown?.();
          break;
        case 'KeyN':
          if (e.shiftKey) {
            e.preventDefault();
            handlers.skipNext?.();
          }
          break;
        case 'KeyP':
          if (e.shiftKey) {
            e.preventDefault();
            handlers.skipPrev?.();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, handlers]);
}
