import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cancelAllWaitDownloads } from './StreamProtocol';
import { handleProxyRequest, decodeProxyUrl, type HlsProxyType } from './HlsProxy';
import { createLogger } from '../util/Logger';

const log = createLogger('StreamServer');

let server: http.Server | null = null;
let serverPort = 0;

/**
 * HLS プロキシを `http://127.0.0.1:{port}/hls/proxy` で提供するローカル専用 HTTP サーバー。
 */
export async function startStreamServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    // HLS プロキシ: /hls/proxy?vid=videoId&url=BASE64&t=m3u8|seg|key
    if (url.pathname === '/hls/proxy') {
      const encodedUrl = url.searchParams.get('url') ?? '';
      const type = (url.searchParams.get('t') ?? 'seg') as HlsProxyType;
      const videoId = url.searchParams.get('vid') ?? '';

      if (!encodedUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('missing url param');
        return;
      }

      handleProxyRequest(encodedUrl, type, buildHlsProxyBase(videoId))
        .then(({ body, contentType, m3u8Meta }) => {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(body);

        })
        .catch((e: unknown) => {
          log.error('hls proxy error:', e);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          res.end(String(e));
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(0, '127.0.0.1', () => {
      serverPort = (server!.address() as AddressInfo).port;
      log.info('stream server listening on port:', serverPort);
      resolve();
    });
    server!.once('error', reject);
  });
}

/** プレイヤーウィンドウ閉時に呼ぶ */
export function cancelAllStreams(): void {
  cancelAllWaitDownloads();
}

export function stopStreamServer(): void {
  cancelAllStreams();
  server?.close();
  server = null;
  serverPort = 0;
}

/** HLS プロキシのベース URL を返す (videoId 付き) */
export function buildHlsProxyBase(videoId: string): string {
  if (serverPort === 0) throw new Error('StreamServer not started yet');
  if (!videoId) return `http://127.0.0.1:${serverPort}/hls/proxy`;
  return `http://127.0.0.1:${serverPort}/hls/proxy?vid=${encodeURIComponent(videoId)}`;
}

