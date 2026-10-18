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
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<CommentRenderer | null>(null);

    useEffect(() => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container || !video) return;
      const renderer = new CommentRenderer(container);
      renderer.setConfig({
        ...DEFAULT_RENDER_CONFIG,
        ...config,
        ...(ngList ? { ngList } : {})
      });
      renderer.setComments(comments);
      rendererRef.current = renderer;

      let started = false;
      let resizeTimer: number | null = null;

      let startRafId: number | null = null;

      const tryStart = (width: number, height: number): void => {
        if (started || width <= 0 || height <= 0) return;
        started = true;
        // canvas がブラウザ側でレイアウト/コンポジット確定する前に
        // WebGL2 コンテキストを取得するとシェーダーコンパイルが失敗することがあるため、
        // 1フレーム遅延させてから開始する
        startRafId = requestAnimationFrame(() => {
          startRafId = null;
          // onResize で canvas サイズを確定してから start
          renderer.onResize(width, height);
          renderer.start(video);
        });
      };

      // コメント領域を、親 (動画の表示枠) の中で映像が実際に描画される矩形 (object-fit: contain 相当) に合わせる。
      // 4:3 動画など枠と比が違う場合に、黒帯側へコメントが流れないようにする。
      // メタデータ未取得 (videoWidth = 0) の間は枠全体を使う。
      const fitToVideo = (): void => {
        const parent = container.parentElement;
        if (!parent) return;
        const pw = parent.clientWidth;
        const ph = parent.clientHeight;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        let w = pw;
        let h = ph;
        if (vw > 0 && vh > 0 && pw > 0 && ph > 0) {
          const scale = Math.min(pw / vw, ph / vh);
          w = vw * scale;
          h = vh * scale;
        }
        const s = container.style;
        s.right = 'auto';
        s.bottom = 'auto';
        s.left = `${(pw - w) / 2}px`;
        s.top = `${(ph - h) / 2}px`;
        s.width = `${w}px`;
        s.height = `${h}px`;
      };

      const resize = (): void => {
        fitToVideo();
        const rect = container.getBoundingClientRect();
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
      ro.observe(container);
      // 枠のサイズ変化 (コンテナ自身は映像矩形に追従するので親も監視する)
      if (container.parentElement) ro.observe(container.parentElement);
      // 動画の切替・解像度変化で映像の比が変わったら矩形を再計算
      video.addEventListener('loadedmetadata', resize);
      video.addEventListener('resize', resize);

      const onSeek = (): void => renderer.onSeek();
      video.addEventListener('seeking', onSeek);
      video.addEventListener('seeked', onSeek);

      return () => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        if (startRafId !== null) cancelAnimationFrame(startRafId);
        ro.disconnect();
        video.removeEventListener('loadedmetadata', resize);
        video.removeEventListener('resize', resize);
        video.removeEventListener('seeking', onSeek);
        video.removeEventListener('seeked', onSeek);
        renderer.stop();
        rendererRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- レンダラーは video 要素ごとに作り直し、コメント・設定の更新は下の effect で反映する
    }, [videoRef]);

    // コメント更新
    useEffect(() => {
      rendererRef.current?.setComments(comments);
    }, [comments]);

    // 設定/NG更新
    useEffect(() => {
      rendererRef.current?.setConfig({ ...config, ...(ngList ? { ngList } : {}) });
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
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: passThrough ? 'none' : 'auto' }}
      />
    );
  }
);
