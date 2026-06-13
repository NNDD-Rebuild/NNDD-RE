import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react';
import type { NNDDREComment, NgListItem } from '@shared/types';
import {
  CommentRenderer,
  DEFAULT_RENDER_CONFIG,
  type CommentRenderConfig
} from './CommentRenderer';

export interface CommentOverlayHandle {
  /** コメント一覧をセット */
  setComments: (comments: NNDDREComment[]) => void;
  /** 設定を変更 */
  setConfig: (cfg: Partial<CommentRenderConfig>) => void;
  /** seek 時に呼ぶ */
  notifySeek: () => void;
}

interface Props {
  /** 同期する <video> 要素 */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** 表示するコメント */
  comments: NNDDREComment[];
  /** NGリスト */
  ngList?: NgListItem[];
  /** 描画設定 */
  config?: Partial<CommentRenderConfig>;
  /** クリック透過 (デフォルト true) */
  passThrough?: boolean;
}

/**
 * 動画上に重ねるコメント描画オーバーレイ。
 * 元: VideoPlayer.mxml の Canvas + CommentManager
 */
export const CommentOverlay = forwardRef<CommentOverlayHandle, Props>(
  function CommentOverlay(
    { videoRef, comments, ngList, config, passThrough = true },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<CommentRenderer | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const renderer = new CommentRenderer(canvas);
      renderer.setConfig({
        ...DEFAULT_RENDER_CONFIG,
        ...config,
        ngList: ngList ?? []
      });
      renderer.setComments(comments);
      rendererRef.current = renderer;

      let started = false;
      let resizeTimer: number | null = null;

      const tryStart = (width: number, height: number): void => {
        if (started || width <= 0 || height <= 0) return;
        started = true;
        // onResize で canvas サイズを確定してから start
        renderer.onResize(width, height);
        renderer.start(video);
      };

      const resize = (): void => {
        const rect = canvas.getBoundingClientRect();
        if (!started) {
          tryStart(rect.width, rect.height);
        } else {
          // リサイズをデバウンス: 100ms 静止後に rebuild
          if (resizeTimer !== null) window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            resizeTimer = null;
            renderer.onResize(rect.width, rect.height);
          }, 100);
        }
      };

      // 初回: レイアウト済みなら即 start; 未確定なら ResizeObserver に委ねる
      resize();

      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      const onSeek = (): void => renderer.onSeek();
      video.addEventListener('seeking', onSeek);
      video.addEventListener('seeked', onSeek);

      return () => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        ro.disconnect();
        video.removeEventListener('seeking', onSeek);
        video.removeEventListener('seeked', onSeek);
        renderer.stop();
        rendererRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoRef]);

    // コメント更新
    useEffect(() => {
      rendererRef.current?.setComments(comments);
    }, [comments]);

    // 設定/NG更新
    useEffect(() => {
      rendererRef.current?.setConfig({ ...config, ngList: ngList ?? [] });
    }, [config, ngList]);

    useImperativeHandle(
      ref,
      () => ({
        setComments: (c: NNDDREComment[]) =>
          rendererRef.current?.setComments(c),
        setConfig: (cfg) => rendererRef.current?.setConfig(cfg),
        notifySeek: () => rendererRef.current?.onSeek()
      }),
      []
    );

    return (
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: passThrough ? 'none' : 'auto' }}
      />
    );
  }
);
