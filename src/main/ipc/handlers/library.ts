import path from 'node:path';
import { ipcMain, shell } from 'electron';
import { IpcChannel } from '@shared/types';
import { NicoHistoryClient } from '../../nicovideo';
import { LibraryScanner } from '../../library/LibraryScanner';
import { NICOWARI_MARK, readNicowariSwf } from '../../library/NicowariSwf';
import { createLogger } from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * ライブラリ (LIBRARY_*)・視聴履歴 (HISTORY_* / NICO_HISTORY_* / WATCHED_*)・
 * プレイリスト (PLAYLIST_*)・再生位置レジューム (RESUME_*)。
 */
export function registerLibraryHandlers(ctx: IpcHandlerContext): void {
  const { library } = ctx;

  // --- ライブラリ ---
  ipcMain.handle(IpcChannel.LIBRARY_LIST, () => {
    const all = library.videoDao.listWithTags();
    const root = path.resolve(library.videoDir);
    return all.filter((v) => {
      const rel = path.relative(root, path.resolve(v.uri));
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });
  });

  ipcMain.handle(IpcChannel.LIBRARY_GET, (_e, id: number) => {
    return library.videoDao.getById(id);
  });

  ipcMain.handle(IpcChannel.LIBRARY_DELETE, async (_e, id: number) => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const video = library.videoDao.getById(id);
    if (video) {
      const dir = pmod.dirname(video.uri);
      const base = pmod.basename(video.uri).replace(/\.[^.]+$/, '');
      const videoId = LibraryScanner.extractVideoId(base);
      // [IchibaInfo].html は NNDD 互換用として削除しない
      const targets = (
        videoId ? LibraryScanner.findRelatedFiles(dir, videoId) : [video.uri]
      ).filter((p) => !p.endsWith('[IchibaInfo].html'));
      for (const p of targets) {
        try {
          if (fsmod.existsSync(p)) fsmod.unlinkSync(p);
        } catch (e) {
          log.warn('failed to delete file', p, e);
        }
      }
    }
    library.videoDao.delete(id);
    return true;
  });

  ipcMain.handle(IpcChannel.LIBRARY_SCAN, async () => {
    return LibraryScanner.scan(library);
  });

  ipcMain.handle(
    IpcChannel.LIBRARY_UPDATE_TAGS,
    (_e, id: number, tags: string[]) => {
      library.videoDao.setTags(id, tags);
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.LIBRARY_SET_FAVORITE,
    (_e, id: number, isFavorite: boolean) => {
      library.videoDao.setFavorite(id, isFavorite);
      return true;
    }
  );

  // --- 履歴 ---
  ipcMain.handle(IpcChannel.HISTORY_LIST, (_e, limit?: number) => {
    return library.historyDao.list(limit ?? 1000);
  });

  ipcMain.handle(IpcChannel.HISTORY_CLEAR, () => {
    library.historyDao.clear();
    return true;
  });

  ipcMain.handle(
    IpcChannel.HISTORY_ADD,
    (
      _e,
      item: {
        videoId: string;
        title: string;
        thumbnailUrl?: string;
        isLocal?: boolean;
        watchSeconds?: number;
      }
    ) => {
      library.historyDao.add({
        videoId: item.videoId,
        title: item.title ?? item.videoId,
        thumbnailUrl: item.thumbnailUrl ?? '',
        watchedAt: new Date(),
        isLocal: Boolean(item.isLocal),
        watchSeconds: item.watchSeconds ?? 0
      });
      return true;
    }
  );

  // --- ニコニコ動画本家 視聴履歴 ---
  ipcMain.handle(IpcChannel.NICO_HISTORY_LIST, () => {
    return library.nicoWatchHistoryDao.list(1000);
  });

  ipcMain.handle(IpcChannel.NICO_HISTORY_SYNC, async () => {
    await NicoHistoryClient.syncOnStartup(library.nicoWatchHistoryDao);
    return library.nicoWatchHistoryDao.list(1000);
  });

  ipcMain.handle(IpcChannel.WATCHED_CHECK_BATCH, (_e, videoIds: string[]) => {
    const fromApp = library.historyDao.existsBatch(videoIds);
    const fromNico = library.nicoWatchHistoryDao.existsBatch(videoIds);
    return videoIds.filter((id) => fromApp.has(id) || fromNico.has(id));
  });

  // --- プレイリスト (完全ローカル) ---
  ipcMain.handle(IpcChannel.PLAYLIST_LIST, () => {
    return library.playlistDao.list();
  });

  ipcMain.handle(IpcChannel.PLAYLIST_CREATE, (_e, name: string) => {
    return library.playlistDao.create(name);
  });

  ipcMain.handle(IpcChannel.PLAYLIST_RENAME, (_e, args: { id: number; name: string }) => {
    library.playlistDao.rename(args.id, args.name);
    return true;
  });

  ipcMain.handle(
    IpcChannel.PLAYLIST_UPDATE_ICON,
    (_e, args: { id: number; icon: string | null }) => {
      library.playlistDao.updateIcon(args.id, args.icon);
      return true;
    }
  );

  ipcMain.handle(IpcChannel.PLAYLIST_REMOVE, (_e, id: number) => {
    library.playlistDao.remove(id);
    return true;
  });

  ipcMain.handle(IpcChannel.PLAYLIST_GET_ITEMS, (_e, id: number) => {
    return library.playlistDao.getItems(id);
  });

  ipcMain.handle(
    IpcChannel.PLAYLIST_ADD_VIDEO,
    (
      _e,
      args: { playlistId: number; videoId: string; title: string; thumbnailUrl: string; lengthSec: number }
    ) => {
      library.playlistDao.addVideo(args.playlistId, args);
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.PLAYLIST_REMOVE_VIDEO,
    (_e, args: { playlistId: number; videoId: string }) => {
      library.playlistDao.removeVideo(args.playlistId, args.videoId);
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.PLAYLIST_REORDER,
    (_e, args: { playlistId: number; videoIds: string[] }) => {
      library.playlistDao.reorder(args.playlistId, args.videoIds);
      return true;
    }
  );

  ipcMain.handle(IpcChannel.PLAYLIST_LIST_CONTAINING, (_e, videoId: string) => {
    return library.playlistDao.listPlaylistIdsForVideo(videoId);
  });

  // --- 再生位置レジューム ---
  ipcMain.handle(IpcChannel.RESUME_GET, (_e, videoKey: string) => {
    return library.resumeDao.get(videoKey);
  });

  ipcMain.handle(
    IpcChannel.RESUME_SAVE,
    (_e, args: { videoKey: string; positionSec: number; durationSec: number }) => {
      library.resumeDao.save(args.videoKey, args.positionSec, args.durationSec);
      return true;
    }
  );

  ipcMain.handle(IpcChannel.RESUME_CLEAR, (_e, videoKey: string) => {
    library.resumeDao.clear(videoKey);
    return true;
  });

  ipcMain.handle(IpcChannel.RESUME_LIST_BATCH, (_e, videoKeys: string[]) => {
    return library.resumeDao.listBatch(videoKeys);
  });

  // --- ニコニコ市場情報ファイルを開く ---
  ipcMain.handle(IpcChannel.LIBRARY_OPEN_ICHIBA, async (_e, videoUri: string) => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const { VideoFileSuffix } = await import('@shared/constants');
    const dir = pmod.dirname(videoUri);
    const base = pmod.basename(videoUri).replace(/\.[^.]+$/, '');
    const htmlPath = pmod.join(dir, `${base}${VideoFileSuffix.ICHIBA_INFO_HTML}`);
    if (!fsmod.existsSync(htmlPath)) return null;
    await shell.openPath(htmlPath);
    return htmlPath;
  });

  // ライブラリ フォルダ操作
  ipcMain.handle(IpcChannel.LIBRARY_CHECK_BATCH, async (_e, videoIds: string[]) => {
    const root = path.resolve(library.videoDir);
    const result: string[] = [];
    const CHUNK_SIZE = 50;
    for (let i = 0; i < videoIds.length; i += CHUNK_SIZE) {
      const chunk = videoIds.slice(i, i + CHUNK_SIZE);
      for (const id of chunk) {
        const v = library.videoDao.getByKey(id);
        if (!v) continue;
        const rel = path.relative(root, path.resolve(v.uri));
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) result.push(id);
      }
      if (i + CHUNK_SIZE < videoIds.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return result;
  });

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_CREATE, async (_e, folderName: string) => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const dir = pmod.join(library.videoDir, folderName);
    fsmod.mkdirSync(dir, { recursive: true });
    return dir;
  });

  ipcMain.handle(
    IpcChannel.LIBRARY_VIDEO_MOVE,
    async (_e, { videoIds, targetFolder }: { videoIds: number[]; targetFolder: string }) => {
      const fsmod = await import('node:fs');
      const pmod = await import('node:path');
      for (const id of videoIds) {
        const video = library.videoDao.getById(id);
        if (!video) continue;
        const dir = pmod.dirname(video.uri);
        const base = pmod.basename(video.uri).replace(/\.[^.]+$/, '');
        const videoId = LibraryScanner.extractVideoId(base);
        const targets = videoId
          ? LibraryScanner.findRelatedFiles(dir, videoId)
          : [video.uri];

        for (const src of targets) {
          const dest = pmod.join(targetFolder, pmod.basename(src));
          try { fsmod.renameSync(src, dest); } catch (e) { log.warn('move error:', src, '->', dest, e); }
        }
        // DBのuriを更新
        const newUri = pmod.join(targetFolder, pmod.basename(video.uri));
        library.videoDao.updateUri(id, newUri);
      }
      return true;
    }
  );

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_LIST, async () => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const root = library.videoDir;
    if (!fsmod.existsSync(root)) return [];
    // サブフォルダも含め階層をすべて返す (呼び出し側でパスのprefix関係からツリーを再構築する)。
    const result: string[] = [];
    const walk = (dir: string): void => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = fsmod.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        // 直下の system は本家NNDDの管理フォルダなので表示対象外
        if (dir === root && ent.name.toLowerCase() === 'system') continue;
        const p = pmod.join(dir, ent.name);
        result.push(p);
        walk(p);
      }
    };
    walk(root);
    return result;
  });

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_DELETE, async (_e, folderPath: string) => {
    const fsmod = await import('node:fs');
    // DB から該当フォルダ配下 (サブフォルダ含む) の動画を削除
    const normFolder = folderPath.replace(/[/\\]+$/, '');
    const videos = library.videoDao.listWithTags().filter((v) => {
      const d = v.uri.replace(/[/\\][^/\\]+$/, '');
      return d === normFolder || d.startsWith(normFolder + '/') || d.startsWith(normFolder + '\\');
    });
    for (const v of videos) {
      library.videoDao.delete(v.id);
    }
    // フォルダごと削除
    try {
      fsmod.rmSync(folderPath, { recursive: true, force: true });
    } catch (e) {
      log.warn('folder delete error:', e);
    }
    return true;
  });

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_VIDEOS, async (_e, folderPath: string) => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const VIDEO_EXTS = new Set(['.mp4', '.flv', '.swf', '.webm', '.mkv', '.m4a']);
    if (!fsmod.existsSync(folderPath)) return [];
    try {
      const names = fsmod.readdirSync(folderPath);
      const lowerNames = new Set(names.map((name) => name.toLowerCase()));
      return names
        .filter((name) => VIDEO_EXTS.has(pmod.extname(name).toLowerCase()))
        // ニコ割素材 (動画本体と同じ動画IDを名乗る広告用Flash) は動画本体ではないので除外
        .filter((name) => !name.includes(NICOWARI_MARK))
        // 同名の .flv がある .swf は連続再生リストに入れない (.flv を優先して再生する)
        .filter((name) => !(
          pmod.extname(name).toLowerCase() === '.swf' &&
          lowerNames.has(name.slice(0, -4).toLowerCase() + '.flv')
        ))
        .sort((a, b) => a.localeCompare(b, 'ja'))
        .map((name) => pmod.join(folderPath, name));
    } catch {
      return [];
    }
  });

  // ニコ割SWFから画像・音声を取り出す
  ipcMain.handle(IpcChannel.LIBRARY_NICOWARI_READ, async (_e, swfPath: string) => {
    const pmod = await import('node:path');
    const name = pmod.basename(swfPath ?? '');
    if (!name.includes(NICOWARI_MARK) || !name.toLowerCase().endsWith('.swf')) {
      throw new Error('ニコ割のSWFファイルではありません');
    }
    return readNicowariSwf(swfPath);
  });
}
