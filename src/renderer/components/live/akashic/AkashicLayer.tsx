import { useEffect, useRef, useState } from 'react';
import { IpcChannel } from '@shared/types';
import type {
  LiveAkashicApiRequest,
  LiveAkashicApiResponse,
  LiveAkashicBatch,
  LiveAkashicInfo,
  LiveProgramInfo
} from '@shared/types';

/**
 * main から届いた akashic の状態更新を AkashicLayer に渡す経路。
 * レイヤーがまだ無い間 (番組情報の取得前など) は buffer に溜めておき、マウント時に順に流す。
 */
export interface AkashicBus {
  buffer: LiveAkashicBatch[];
  sink: ((batch: LiveAkashicBatch) => void) | null;
}

export function createAkashicBus(): AkashicBus {
  return { buffer: [], sink: null };
}

export function pushAkashicBatch(bus: AkashicBus, batch: LiveAkashicBatch): void {
  if (bus.sink) bus.sink(batch);
  else bus.buffer.push(batch);
}

/**
 * ホストの文書。親の CSP を引き継がせないため、srcdoc ではなく別の HTML ファイル (public/akashic) として読み込む。
 * 開発サーバーでも本番 (file://) でも、このウィンドウの HTML からの相対パスで解決できる
 */
const HOST_URL = new URL('./akashic/akashic-host.html', window.location.href).toString();

/**
 * iframe の sandbox。
 * 本番 (file://) は、origin を opaque にするとホスト自身のスクリプトも file:// から読めなくなる。file:// の文書は
 * 1 ファイルごとに別 origin なので、allow-same-origin を付けても親 (window.nndd) には届かない。
 * 開発サーバー (http) は同じ origin になってしまうので、付けずに opaque origin のまま動かす。
 */
const FRAME_SANDBOX = window.location.protocol === 'file:' ? 'allow-scripts allow-same-origin' : 'allow-scripts';

interface Props {
  bus: AkashicBus;
  info: LiveAkashicInfo;
  program: LiveProgramInfo;
  /** 映像の音量 (muted / volume) をゲームの効果音に反映する */
  videoEl: HTMLVideoElement | null;
  /** iframe 上でマウスが動いた (全画面で操作バーを出すため。iframe は親にマウスイベントを渡さない) */
  onPointerActivity: () => void;
}

function videoVolume(v: HTMLVideoElement | null): number {
  return !v || v.muted ? 0 : v.volume;
}

/**
 * ニコ生ゲーム (クルーズの行き先投票や番組情報の表示など) を映像の上に重ねる。
 *
 * ゲームのコードは公式 CDN から読み込んだものなので、preload (window.nndd) を持たない
 * sandbox 付き iframe (別文書) の中で動かし、親とは postMessage だけでやり取りする。
 * ゲームが画面を占めている間 (子ゲームの実行中) だけ iframe がマウスを受け取り、それ以外は映像の操作を邪魔しない。
 */
export function AkashicLayer({ bus, info, program, videoEl, onPointerActivity }: Props): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<LiveAkashicBatch[]>([]);
  const [active, setActive] = useState(false);
  // メッセージ購読はマウント時の 1 回だけなので、最新のコールバックは ref 経由で呼ぶ
  const onPointerRef = useRef(onPointerActivity);
  onPointerRef.current = onPointerActivity;

  const post = (msg: unknown): void => {
    frameRef.current?.contentWindow?.postMessage(msg, '*');
  };

  // main からの状態更新を iframe へ流す (iframe の準備前は溜める)
  useEffect(() => {
    const send = (batch: LiveAkashicBatch): void => {
      if (readyRef.current) post({ t: 'batch', batch });
      else queueRef.current.push(batch);
    };
    bus.sink = send;
    const pending = bus.buffer.splice(0);
    pending.forEach(send);
    return () => {
      if (bus.sink === send) bus.sink = null;
    };
  }, [bus]);

  // 映像の音量変更をゲームの効果音へ
  useEffect(() => {
    if (!videoEl) return;
    const onVolume = (): void => post({ t: 'volume', volume: videoVolume(videoEl) });
    videoEl.addEventListener('volumechange', onVolume);
    return () => videoEl.removeEventListener('volumechange', onVolume);
  }, [videoEl]);

  // iframe からの要求
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data as { t?: string } & Record<string, unknown>;
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'ready': {
          readyRef.current = true;
          post({
            t: 'init',
            programId: program.programId,
            providerType: program.providerType,
            coeContentBaseUrl: info.coeContentBaseUrl,
            account: info.account,
            volume: videoVolume(videoEl)
          });
          queueRef.current.splice(0).forEach((batch) => post({ t: 'batch', batch }));
          break;
        }
        case 'api': {
          const id = m.id as number;
          window.nndd
            .invoke<LiveAkashicApiResponse>(IpcChannel.LIVE_AKASHIC_API, m.req as LiveAkashicApiRequest)
            .then((res) => post({ t: 'apiRes', id, res }))
            .catch((err) => post({ t: 'apiRes', id, err: err instanceof Error ? err.message : String(err) }));
          break;
        }
        case 'open': {
          const url = String(m.url ?? '');
          const lv = url.match(/^https:\/\/live\.nicovideo\.jp\/watch\/((?:lv|co|ch)\d+)/);
          if (lv) void window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, lv[1]).catch(() => {});
          else if (/^https?:\/\//.test(url)) void window.nndd.invoke(IpcChannel.SYS_OPEN_PATH, url).catch(() => {});
          break;
        }
        case 'active':
          setActive(Boolean(m.active));
          break;
        case 'pointer':
          onPointerRef.current();
          break;
        case 'log':
          console[m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'log'](
            `[akashic] ${String(m.msg ?? '')}`,
            m.data ?? ''
          );
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // init に使う値は iframe の 'ready' 時点のもの。レイヤーは番組ごとに作り直す (key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={frameRef}
      title="ニコ生ゲーム"
      sandbox={FRAME_SANDBOX}
      allow="autoplay"
      src={HOST_URL}
      className="absolute inset-0 w-full h-full border-0"
      style={{ background: 'transparent', colorScheme: 'normal', pointerEvents: active ? 'auto' : 'none' }}
    />
  );
}
