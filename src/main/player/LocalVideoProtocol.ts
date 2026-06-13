import { protocol, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
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
 * app.whenReady() 後に呼ぶ。プロトコルハンドラーを登録する。
 */
export function registerProtocolHandler(): void {
  protocol.handle(SCHEME, async (req) => {
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

      const stat = fs.statSync(resolved);
      const fileSize = stat.size;

      const ext = path.extname(resolved).toLowerCase();

      const MIME: Record<string, string> = {
        '.mp4': 'video/mp4', '.m4v': 'video/mp4',
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
      const contentType = MIME[ext] ?? 'application/octet-stream';

      const rangeHeader = req.headers.get('range');
      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end   = m && m[2] ? parseInt(m[2], 10) : fileSize - 1;
        const clampedEnd = Math.min(end, fileSize - 1);
        const chunkSize = clampedEnd - start + 1;
        const stream = Readable.toWeb(
          fs.createReadStream(resolved, { start, end: clampedEnd })
        ) as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
          },
        });
      }

      // Range なし → 全体
      const stream = Readable.toWeb(
        fs.createReadStream(resolved)
      ) as ReadableStream;
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
        },
      });
    } catch (e) {
      log.error('protocol handler error:', e);
      return new Response(`error: ${e}`, { status: 500 });
    }
  });
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
