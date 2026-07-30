import { protocol, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../util/Logger';
import { NNDD_LOCAL_SCHEME, buildLocalUrl } from '../../shared/constants/paths';

const log = createLogger('LocalVideoProtocol');

/**
 * ローカル動画ファイルを安全に <video> 要素から再生するためのカスタムプロトコル。
 *
 * 設計:
 *  - スキーム: `nndd-re-local`
 *  - 形式: `nndd-re-local://video?path=<URL encoded absolute path>`
 *
 * Electronの `file://` を直接使うと CSP/権限の問題が出るため、
 * ライブラリディレクトリ配下のファイルだけを許可するセーフなプロトコルとして提供する。
 */
const SCHEME = NNDD_LOCAL_SCHEME;
export const LOCAL_SCHEME = SCHEME;

/**
 * 許可ディレクトリリスト (ライブラリ等)。
 * `register()` 呼び出し側でセットする。
 */
let allowedRoots: string[] = [];

export function setAllowedVideoRoots(roots: string[]): void {
  allowedRoots = roots.map((r) => path.resolve(r));
  log.info('allowed video roots:', allowedRoots);
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

/** 拡張子から Content-Type を返す (StreamServer のローカル配信でも共用) */
export function getMimeType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 許可ルート配下かどうか (StreamServer のローカル配信でも共用) */
export function isPathAllowed(filePath: string): boolean {
  return isAllowed(filePath);
}

/**
 * Electron 起動前に呼ぶ。
 * カスタムスキームの権限 (streaming, secure, supportFetchAPI) を宣言する。
 */
/** main.ts の registerSchemesAsPrivileged に渡すエントリを返す */
export function getLocalSchemePrivilege(): Electron.CustomScheme {
  return {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true
    }
  };
}

/** @deprecated main.ts で registerSchemesAsPrivileged を一括呼び出しするため不要。後方互換用。 */
export function registerScheme(): void {
  // no-op: 登録は main.ts の registerAllSchemes() で行う
}

/**
 * app.whenReady() 後に呼ぶ。デフォルトセッションにプロトコルハンドラーを登録する。
 */
export function registerProtocolHandler(): void {
  protocol.handle(SCHEME, handleRequest);
}

/**
 * hideWatchHistory=ON時などに生成される非デフォルトpartitionセッションにも
 * このプロトコルを登録する。登録しないと当該ウィンドウで `nndd-re-local://`
 * が解決できず、ローカル再生がストリーミングにフォールバックしてしまう。
 */
export function registerProtocolHandlerForSession(sess: Electron.Session): void {
  sess.protocol.handle(SCHEME, handleRequest);
}

async function handleRequest(req: Request): Promise<Response> {
    try {
      const u = new URL(req.url);
      const filePath = u.searchParams.get('path');
      if (!filePath) {
        return new Response('missing path', { status: 400 });
      }
      const resolved = path.resolve(decodeURIComponent(filePath));

      if (!isAllowed(resolved)) {
        log.warn('access denied:', resolved);
        return new Response('forbidden', { status: 403 });
      }
      if (!fs.existsSync(resolved)) {
        return new Response('not found', { status: 404 });
      }

      const contentType = getMimeType(resolved);
      const fileSize = fs.statSync(resolved).size;

      const rangeHeader = req.headers.get('range');
      const m = rangeHeader ? rangeHeader.match(/bytes=(\d*)-(\d*)/) : null;
      let start: number;
      let end: number;
      if (m && m[1] === '' && m[2] !== '') {
        start = Math.max(0, fileSize - parseInt(m[2], 10));
        end = fileSize - 1;
      } else {
        start = m && m[1] ? parseInt(m[1], 10) : 0;
        end = m && m[2] ? parseInt(m[2], 10) : fileSize - 1;
      }
      if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) {
        log.warn(`range not satisfiable: "${rangeHeader}" fileSize=${fileSize}`);
        return new Response('range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }
      const clampedEnd = Math.min(end, fileSize - 1);
      const chunkSize = clampedEnd - start + 1;

      const fh = await fs.promises.open(resolved, 'r');
      let pos = start;
      let sent = 0;
      let closed = false;
      let canceled = false;
      const closeOnce = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        await fh.close().catch(() => { /* ignore */ });
      };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (canceled) return;
          if (sent >= chunkSize) {
            controller.close();
            await closeOnce();
            return;
          }
          const toRead = Math.min(65536, chunkSize - sent);
          const buf = Buffer.allocUnsafe(toRead);
          try {
            const { bytesRead } = await fh.read(buf, 0, toRead, pos);
            if (canceled) return;
            if (bytesRead === 0) {
              controller.close();
              await closeOnce();
              return;
            }
            controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
            pos += bytesRead;
            sent += bytesRead;
          } catch (err) {
            if (!canceled) {
              log.warn(`read error @pos=${pos}:`, err);
              controller.error(err);
            }
            await closeOnce();
          }
        },
        async cancel() {
          canceled = true;
          await closeOnce();
        },
      });
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
        },
      });
    } catch (e) {
      log.error('protocol handler error:', e);
      return new Response(`error: ${e}`, { status: 500 });
    }
}

/**
 * 指定パスがいずれかの許可ルート配下にあるかチェック。
 */
function isAllowed(filePath: string): boolean {
  if (allowedRoots.length === 0) return false;
  const resolved = path.resolve(filePath);
  return allowedRoots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/** @deprecated shared の buildLocalUrl を使うこと */
export function buildLocalVideoUrl(absolutePath: string): string {
  return buildLocalUrl(absolutePath);
}

export const LOCAL_VIDEO_SCHEME = SCHEME;

// 利便関数: app から userData を許可リストに自動追加する
export function autoConfigureAllowedRoots(extra: string[] = []): void {
  const roots = [
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('userData'),
    ...extra
  ];
  setAllowedVideoRoots(roots);
}
