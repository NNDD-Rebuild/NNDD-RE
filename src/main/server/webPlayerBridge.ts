import type { Express, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { IpcChannel } from '@shared/types';
import type { LibraryManager } from '../db/LibraryManager';
import { PlayerManager } from '../player/PlayerManager';
import { invokeRegisteredHandler, hasRegisteredHandler } from '../ipc/ipcRegistry';
import { createLogger } from '../util/Logger';

const log = createLogger('WebPlayerBridge');

/**
 * ブラウザ版 (web-app.html = REのライブラリ+プレイヤーをそのまま配信) 用のブリッジ。
 *
 * ブラウザ側の window.nndd shim (src/renderer/webShim.ts) が
 *   POST /api/ipc { channel, args }
 * で IPC ハンドラを呼ぶ。event.sender や Electron 固有機能に依存するチャンネルは
 * 許可しない。ライブラリ外のパスは読ませない。
 */

type PathChecker = (p: string) => boolean;
type Guard = (args: unknown[], isLibraryPath: PathChecker) => boolean;

const isStr = (v: unknown): v is string => typeof v === 'string';
const pathArg =
  (i: number): Guard =>
  (args, ok) =>
    isStr(args[i]) && ok(args[i] as string);
const anyArgs: Guard = () => true;
const configKey: Guard = (args) =>
  isStr(args[0]) && /^(player|ui)\.[A-Za-z0-9_.]+$/.test(args[0]);

/** ブラウザから呼べる IPC チャンネル → 引数検証 */
const ALLOWED: Record<string, Guard> = {
  [IpcChannel.CONFIG_GET]: configKey,
  // ローカル (ライブラリ) 再生に必要な読み取り系
  [IpcChannel.COMMENT_READ_LOCAL]: pathArg(0),
  [IpcChannel.COMMENT_NOW_IDS_READ]: pathArg(0),
  [IpcChannel.THUMB_INFO_XML_READ]: pathArg(0),
  [IpcChannel.LIBRARY_FOLDER_VIDEOS]: pathArg(0),
  // ライブラリ一覧 (読み取りのみ。削除・移動・スキャン等の変更系は許可しない)
  [IpcChannel.LIBRARY_LIST]: anyArgs,
  [IpcChannel.LIBRARY_FOLDER_LIST]: anyArgs,
  // 動画情報 (シリーズ・関連動画・投稿者アイコン等。ホスト側のニコニコAPIを叩く)
  [IpcChannel.VIDEO_GET_WATCH_INFO]: anyArgs,
  [IpcChannel.VIDEO_GET_RELATED]: anyArgs,
  [IpcChannel.SERIES_FETCH]: anyArgs,
  [IpcChannel.USER_ICON_FETCH]: anyArgs,
  [IpcChannel.WATCHED_CHECK_BATCH]: anyArgs,
  [IpcChannel.VIDEO_INCREMENT_PLAY_COUNT]: anyArgs,
  [IpcChannel.NG_LIST_COMMENT]: anyArgs
};

function makePathChecker(library: LibraryManager): PathChecker {
  const norm = (p: string): string => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return (p: string): boolean => {
    if (!p) return false;
    const root = norm(library.videoDir);
    const target = norm(p);
    return target === root || target.startsWith(root + path.sep);
  };
}

const VIDEO_ID_RE = /\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/;

export interface WebPlayerBridgeOptions {
  library: LibraryManager;
  /** 動画共有が許可されているか */
  isVideoAllowed: () => boolean;
  /** ファイルを Range 対応で配信する (NnddHttpServer の実装を再利用) */
  streamFile: (req: Request, res: Response, filePath: string) => void;
}

export function registerWebPlayerRoutes(app: Express, opts: WebPlayerBridgeOptions): void {
  const { library } = opts;
  const isLibraryPath = makePathChecker(library);

  // 汎用 IPC ブリッジ
  app.post('/api/ipc', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { channel?: unknown; args?: unknown };
    const channel = body.channel;
    const args = Array.isArray(body.args) ? body.args : [];
    if (!isStr(channel) || !Object.prototype.hasOwnProperty.call(ALLOWED, channel)) {
      res.status(403).json({ error: `channel not allowed: ${String(channel)}` });
      return;
    }
    if (!ALLOWED[channel](args, isLibraryPath)) {
      res.status(403).json({ error: 'invalid arguments' });
      return;
    }
    if (!hasRegisteredHandler(channel)) {
      res.status(503).json({ error: 'handler not ready' });
      return;
    }
    try {
      const result = await invokeRegisteredHandler(channel, args);
      res.json({ result: result === undefined ? null : result });
    } catch (e) {
      log.warn(`ipc bridge failed: ${channel}`, e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // PlayerApp の `nndd:player:init` 相当のパラメータを返す
  app.get('/api/web-player/init', (req: Request, res: Response) => {
    if (!opts.isVideoAllowed()) {
      res.status(403).json({ error: 'video sharing disabled' });
      return;
    }
    const qId = typeof req.query['videoId'] === 'string' ? req.query['videoId'] : '';
    const qPath = typeof req.query['path'] === 'string' ? req.query['path'] : '';

    let localPath: string | null = null;
    if (qPath) {
      localPath = isLibraryPath(qPath) ? qPath : null;
    } else if (qId) {
      localPath = library.videoDao.getByKey(qId)?.uri ?? null;
    }
    if (!localPath || !isLibraryPath(localPath) || !fs.existsSync(localPath)) {
      res.status(404).json({ error: 'video not found' });
      return;
    }

    const videoId = qId || localPath.match(VIDEO_ID_RE)?.[1];
    res.json({
      videoId,
      localPath,
      localFiles: PlayerManager.get().resolveLocalFiles(localPath),
      audioOnly: localPath.toLowerCase().endsWith('.m4a')
    });
  });

  // ライブラリ配下のローカルファイルを配信 (VIDEO_BUILD_LOCAL_URL 相当)
  app.get('/api/local-media', (req: Request, res: Response) => {
    if (!opts.isVideoAllowed()) {
      res.status(403).send('video sharing disabled');
      return;
    }
    const p = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    if (!isLibraryPath(p) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      res.status(404).send('not found');
      return;
    }
    opts.streamFile(req, res, p);
  });
}
