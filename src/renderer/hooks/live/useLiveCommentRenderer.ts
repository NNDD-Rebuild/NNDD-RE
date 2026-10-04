import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { CommentRenderer, DEFAULT_RENDER_CONFIG } from '../../components/player/CommentRenderer';

export interface LiveCommentRendererOptions {
  /** コメントを描画する重ね合わせ要素 */
  overlayRef: RefObject<HTMLDivElement>;
  videoRef: RefObject<HTMLVideoElement>;
  /** 生成した描画エンジンを入れる (コメント追加・設定変更で使う) */
  rendererRef: MutableRefObject<CommentRenderer | null>;
  /** 今映っている映像の vpos (1/100秒) を返す関数 */
  currentVposRef: MutableRefObject<() => number>;
  showComments: boolean;
}

/**
 * 生放送のコメント描画エンジン (CommentRenderer) をマウント時に作り、
 * 重ね合わせ要素のサイズ変更・シーク・コメント表示切替を伝える。
 */
export function useLiveCommentRenderer({
  overlayRef,
  videoRef,
  rendererRef,
  currentVposRef,
  showComments
}: LiveCommentRendererOptions): void {
  useEffect(() => {
    const container = overlayRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    const renderer = new CommentRenderer(container);
    renderer.setConfig({ ...DEFAULT_RENDER_CONFIG, keepCA: false });
    renderer.setVposProvider(() => currentVposRef.current());
    rendererRef.current = renderer;

    let started = false;
    let resizeTimer: number | null = null;
    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (!started) {
        started = true;
        requestAnimationFrame(() => {
          renderer.onResize(rect.width, rect.height);
          renderer.start(video);
        });
        return;
      }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => renderer.onResize(rect.width, rect.height), 100);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const onSeek = (): void => renderer.onSeek();
    video.addEventListener('seeked', onSeek);
    return () => {
      ro.disconnect();
      video.removeEventListener('seeked', onSeek);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      renderer.stop();
      rendererRef.current = null;
    };
    // 引数はすべて ref。分割前と同じくマウント時に 1 回だけ作る
  }, []);

  useEffect(() => {
    rendererRef.current?.setConfig({ enabled: showComments });
  }, [showComments]);
}
