import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { handleProxyRequest, decodeProxyUrl, type HlsProxyType } from './HlsProxy';
import { getMimeType, isPathAllowed } from './LocalVideoProtocol';
import { LOCAL_MEDIA_PATH } from '../../shared/constants/paths';
import { createLogger } from '../util/Logger';

const log = createLogger('StreamServer');

let server: http.Server | null = null;
let serverPort = 0;

/**
 * ローカルファイル配信エンドポイントのアクセストークン。
 * プロセス起動ごとにランダム生成し、URL に付与したものだけを受け付ける。
 */
const localMediaToken = crypto.randomBytes(24).toString('hex');

/**
 * HLS プロキシを `http://127.0.0.1:{port}/hls/proxy` で提供するローカル専用 HTTP サーバー。
 */
export async function startStreamServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    // ローカルファイル配信: /local/media?token=...&path=...
    if (url.pathname === LOCAL_MEDIA_PATH) {
      handleLocalMedia(req, res, url);
      return;
    }

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

export function stopStreamServer(): void {
  server?.close();
  server = null;
  serverPort = 0;
}

/**
 * ローカル動画をループバック HTTP で配信する。
 *
 * カスタムプロトコル `nndd-re-local://` はシーク時に旧リクエストと新リクエストが
 * 一瞬並行し、Electron 34 以降の `protocol.handle` がそれを扱えず
 * PIPELINE_ERROR_READ で再生が落ちる (electron/electron#38749, #45226)。
 * 素の Node http なら Chromium 側は通常の HTTP レスポンスとして扱うため、
 * Range/シークが正しく動く。
 */
function handleLocalMedia(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const deny = (status: number, msg: string): void => {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(msg);
  };

  if (url.searchParams.get('token') !== localMediaToken) {
    return deny(403, 'forbidden');
  }
  const rawPath = url.searchParams.get('path');
  if (!rawPath) return deny(400, 'missing path');

  const resolved = path.resolve(rawPath);
  if (!isPathAllowed(resolved)) {
    log.warn('local media access denied:', resolved);
    return deny(403, 'forbidden');
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return deny(404, 'not found');
  }
  if (!stat.isFile()) return deny(404, 'not found');

  const fileSize = stat.size;
  const baseHeaders: http.OutgoingHttpHeaders = {
    'Content-Type': getMimeType(resolved),
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': String(fileSize) });
    res.end();
    return;
  }

  const rangeHeader = req.headers.range;
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

  // Range なし / 解釈不能 → 全体を 200 で返す
  if (!m || fileSize === 0) {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': String(fileSize) });
    if (fileSize === 0) {
      res.end();
      return;
    }
    pipeFileRange(res, resolved, 0, fileSize - 1);
    return;
  }

  let start: number;
  let end: number;
  if (m[1] === '') {
    // 末尾指定 (bytes=-N)
    const suffix = parseInt(m[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? fileSize - 1 : Math.min(parseInt(m[2], 10), fileSize - 1);
  }

  if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) {
    log.warn(`range not satisfiable: "${rangeHeader}" fileSize=${fileSize}`);
    res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...baseHeaders,
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': String(end - start + 1)
  });
  pipeFileRange(res, resolved, start, end);
}

/** ファイルの [start, end] をレスポンスへ流す。クライアント切断時は読み込みも止める */
function pipeFileRange(res: http.ServerResponse, filePath: string, start: number, end: number): void {
  const rs = fs.createReadStream(filePath, { start, end });
  rs.on('error', (e) => {
    log.warn('local media read error:', e);
    res.destroy();
  });
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

/** ローカルファイルをループバック HTTP 経由で参照する URL を返す */
export function buildLocalMediaUrl(absolutePath: string): string {
  if (serverPort === 0) throw new Error('StreamServer not started yet');
  return (
    `http://127.0.0.1:${serverPort}${LOCAL_MEDIA_PATH}` +
    `?token=${localMediaToken}&path=${encodeURIComponent(absolutePath)}`
  );
}

/** HLS プロキシのベース URL を返す (videoId 付き) */
export function buildHlsProxyBase(videoId: string): string {
  if (serverPort === 0) throw new Error('StreamServer not started yet');
  if (!videoId) return `http://127.0.0.1:${serverPort}/hls/proxy`;
  return `http://127.0.0.1:${serverPort}/hls/proxy?vid=${encodeURIComponent(videoId)}`;
}

