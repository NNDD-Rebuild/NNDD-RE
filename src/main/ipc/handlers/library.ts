import path from 'node:path';
import { ipcMain, shell, webContents } from 'electron';
import { IpcChannel } from '@shared/types';
import type {
  AccountDataCounts,
  AccountDataEntry,
  AccountDataTransferRequest,
  LibraryScanOptions,
  LibraryScanProgress,
  LibraryScanResult
} from '@shared/types';
import { getConfigStore } from '../../config/ConfigStore';
import { MyListClient, NicoContext, NicoHistoryClient } from '../../nicovideo';
import { AccountManager } from '../../nicovideo/auth/AccountManager';
import {
  buildPlaylistSyncDescription,
  extractPlaylistSyncKey,
  withPlaylistSyncKey,
  type PlaylistSyncResult
} from '@shared/types/playlist';
import { randomUUID } from 'node:crypto';
import {
  mergePlaylistWithServer,
  pushPlaylistAdd,
  pushPlaylistRemove,
  type LocalPlaylistStore
} from '../../nicovideo/mylist/PlaylistServerSync';
import { LibraryScanner } from '../../library/LibraryScanner';
import { NICOWARI_MARK, readNicowariSwf } from '../../library/NicowariSwf';
import { createLogger } from '../../util/Logger';
import { runExclusive } from '../../util/KeyedMutex';
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

  // 「コメントのみ」で取得した動画 (コメントXMLが残っているものだけ)
  ipcMain.handle(IpcChannel.LIBRARY_LIST_COMMENT_ONLY, async () => {
    const fsmod = await import('node:fs');
    return library.videoDao.listCommentOnly().filter((v) => fsmod.existsSync(v.uri));
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

  // スキャンは同時に1本だけ。実行中に呼ばれたら実行中のものの結果を返す
  let scanRun: { controller: AbortController; promise: Promise<LibraryScanResult> } | null = null;

  const startScan = (opts?: LibraryScanOptions): Promise<LibraryScanResult> => {
    if (scanRun) return scanRun.promise;
    const controller = new AbortController();
    let lastSentAt = 0;
    const broadcast = (progress: LibraryScanProgress): void => {
      for (const wc of webContents.getAllWebContents()) {
        wc.send(IpcChannel.LIBRARY_SCAN_PROGRESS, progress);
      }
    };
    const promise = LibraryScanner.scan(library, {
      full: opts?.full === true,
      signal: controller.signal,
      onProgress: (progress) => {
        // 動画ごとに送ると IPC が溢れるので間引く
        const now = Date.now();
        if (now - lastSentAt < 100) return;
        lastSentAt = now;
        broadcast(progress);
      }
    }).finally(() => {
      scanRun = null;
    });
    scanRun = { controller, promise };
    return promise;
  };

  ipcMain.handle(IpcChannel.LIBRARY_SCAN, (_e, opts?: LibraryScanOptions) => startScan(opts));

  ipcMain.handle(IpcChannel.LIBRARY_SCAN_CANCEL, () => {
    if (!scanRun) return false;
    scanRun.controller.abort();
    return true;
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

  ipcMain.handle(IpcChannel.HISTORY_REMOVE, (_e, id: number) => {
    library.historyDao.remove(id);
    return true;
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
    return library.nicoWatchHistoryDao.list(3000);
  });

  ipcMain.handle(IpcChannel.NICO_HISTORY_SYNC, async () => {
    await NicoHistoryClient.syncFull(library.nicoWatchHistoryDao);
    return library.nicoWatchHistoryDao.list(3000);
  });

  ipcMain.handle(IpcChannel.NICO_HISTORY_REMOVE, async (_e, videoId: string) => {
    try {
      await NicoHistoryClient.removeItem(videoId);
    } catch (e) {
      // ブラウザ等で既に消されている場合は本家側が無い扱いなので、ローカルだけ消して続行する
      if ((e as { httpStatus?: number }).httpStatus !== 404) throw e;
    }
    library.nicoWatchHistoryDao.remove(videoId);
    return library.nicoWatchHistoryDao.list(3000);
  });

  ipcMain.handle(IpcChannel.WATCHED_CHECK_BATCH, (_e, videoIds: string[]) => {
    const fromApp = library.historyDao.existsBatch(videoIds);
    const fromNico = library.nicoWatchHistoryDao.existsBatch(videoIds);
    return videoIds.filter((id) => fromApp.has(id) || fromNico.has(id));
  });

  // --- プレイリスト (完全ローカル) ---
  /**
   * ニコニコ側に触れる操作の前に、プレイリストが今のアカウントのものか確かめる。
   * 画面が前のアカウントの一覧を出したままのときに、別のアカウントのマイリストへ書き込まないため
   */
  const assertOwnPlaylist = (id: number): void => {
    if (library.playlistDao.getAccount(id) !== AccountManager.key) {
      throw new Error('このプレイリストは別のアカウントのものです。表示を更新してください');
    }
  };

  ipcMain.handle(IpcChannel.PLAYLIST_LIST, () => {
    return library.playlistDao.list(AccountManager.key);
  });

  ipcMain.handle(IpcChannel.PLAYLIST_CREATE, (_e, name: string) => {
    return library.playlistDao.create(AccountManager.key, name);
  });

  // 同期中のプレイリストは先にサーバーへ反映する。失敗したらローカルも変えない (名前がずれるのを防ぐ)
  ipcMain.handle(IpcChannel.PLAYLIST_RENAME, async (_e, args: { id: number; name: string }) => {
    assertOwnPlaylist(args.id);
    const mylistId = library.playlistDao.getServerMylistId(args.id);
    if (mylistId) await MyListClient.renameMylist(mylistId, args.name);
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

  ipcMain.handle(IpcChannel.PLAYLIST_REMOVE_WITH_SERVER, async (_e, args: { id: number }) => {
    assertOwnPlaylist(args.id);
    const mylistId = library.playlistDao.getServerMylistId(args.id);
    if (!mylistId) throw new Error('このプレイリストはニコニコと同期していません');
    // ニコニコ側を先に消す。失敗したときにプレイリストだけ消えて、同期先が分からなくなるのを防ぐ
    await MyListClient.deleteMylist(mylistId);
    library.playlistDao.remove(args.id);
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
      assertOwnPlaylist(args.playlistId);
      library.playlistDao.addVideo(args.playlistId, args);
      // 同期中ならニコニコ側にも即時反映 (ローカルを先に確定し、失敗はログのみ)
      const mylistId = library.playlistDao.getServerMylistId(args.playlistId);
      if (mylistId) {
        void NicoContext.get().isLoggedIn().then((on) => {
          if (on) return pushPlaylistAdd(mylistId, args.videoId);
        });
      }
      return true;
    }
  );

  ipcMain.handle(
    IpcChannel.PLAYLIST_REMOVE_VIDEO,
    (_e, args: { playlistId: number; videoId: string }) => {
      assertOwnPlaylist(args.playlistId);
      library.playlistDao.removeVideo(args.playlistId, args.videoId);
      const mylistId = library.playlistDao.getServerMylistId(args.playlistId);
      if (mylistId) {
        void NicoContext.get().isLoggedIn().then((on) => {
          if (on) return pushPlaylistRemove(mylistId, args.videoId);
        });
      }
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

  // --- プレイリスト ↔ ニコニコ側マイリスト 同期 ---
  const playlistStore = (id: number): LocalPlaylistStore => ({
    items: () => library.playlistDao.getItems(id),
    add: (item) => library.playlistDao.addVideo(id, item),
    remove: (videoId) => library.playlistDao.removeVideo(id, videoId),
    getBase: () => library.playlistDao.getSyncBase(id),
    setBase: (videoIds) => library.playlistDao.setSyncBase(id, videoIds)
  });

  /**
   * 登録キーを持たない (キー導入前に同期した) プレイリストに、キーを付ける。
   * 同期先マイリストの説明文にも書き込み、別の PC で見たときにプレイリストとして取り込めるようにする。
   * 失敗してもローカル側は変えない (次回の同期でまた試す)。
   */
  const ensureSyncKey = async (id: number, mylistId: string): Promise<void> => {
    if (library.playlistDao.getSyncKey(id)) return;
    const key = randomUUID();
    try {
      await MyListClient.updateMylist(mylistId, { description: (cur) => withPlaylistSyncKey(cur, key) });
      library.playlistDao.setSyncKey(id, key);
    } catch (e) {
      log.warn('playlist: failed to attach sync key:', e);
    }
  };

  ipcMain.handle(IpcChannel.PLAYLIST_SERVER_SYNC, (_e, args: { id: number; force?: boolean }) =>
    // 同じプレイリストの同期は直列に (並走するとサーバーへ二重に追加・削除し、基準も不正になる)
    runExclusive(`playlist-sync:${args.id}`, async () => {
      assertOwnPlaylist(args.id);
      const mylistId = library.playlistDao.getServerMylistId(args.id);
      if (!mylistId) return { ok: false as const, reason: 'notSynced' as const };
      if (!(await NicoContext.get().isLoggedIn())) return { ok: false as const, reason: 'notLoggedIn' as const };
      await ensureSyncKey(args.id, mylistId);
      const result = await mergePlaylistWithServer(mylistId, playlistStore(args.id), { force: args.force === true });
      return { ok: true as const, result };
    })
  );

  ipcMain.handle(IpcChannel.PLAYLIST_SET_SYNC, (_e, args: { id: number; enabled: boolean }) =>
    runExclusive(`playlist-sync:${args.id}`, async () => {
      assertOwnPlaylist(args.id);
      if (!args.enabled) {
        // 解除してもニコニコ側のマイリストは消さない。登録キーは取り込み除外にして、復活させない
        library.playlistDao.unlink(args.id);
        return { ok: true as const };
      }
      if (!(await NicoContext.get().isLoggedIn())) return { ok: false as const, reason: 'notLoggedIn' as const };
      let mylistId = library.playlistDao.getServerMylistId(args.id);
      if (!mylistId) {
        const pl = library.playlistDao.list(AccountManager.key).find((p) => p.id === args.id);
        if (!pl) throw new Error('プレイリストが見つかりません');
        // 非公開で作成。説明文にプレイリスト固有の登録キーを入れる。作成に失敗した (上限など) ときは例外にして、リンクを作らない
        const key = randomUUID();
        mylistId = await MyListClient.createMylist(pl.name, false, buildPlaylistSyncDescription(key));
        library.playlistDao.linkServer(args.id, mylistId, key);
      } else {
        await ensureSyncKey(args.id, mylistId);
      }
      // 初回マージ (基準が無いので和集合)。失敗してもリンクは残し、次回の同期で再試行できる
      let result: PlaylistSyncResult | undefined;
      let error: string | undefined;
      try {
        result = await mergePlaylistWithServer(mylistId, playlistStore(args.id));
      } catch (e) {
        log.warn('playlist initial sync failed:', e);
        error = e instanceof Error ? e.message : String(e);
      }
      return { ok: true as const, result, error };
    })
  );

  // 別の PC で作られたプレイリスト同期用マイリスト (登録キー付き) を、この PC のプレイリストとして取り込む。
  // この PC で削除・同期解除したもの (取り込み除外のキー) や、すでに取り込み済みのものは対象外
  const adopting = new Map<string, Promise<Array<{ id: number; name: string }>>>();
  const adoptServerPlaylists = async (): Promise<Array<{ id: number; name: string }>> => {
    if (!(await NicoContext.get().isLoggedIn())) return [];
    // 取り込み中にアカウントが切り替わっても、始めたアカウントの行として扱う
    const account = AccountManager.key;
    const known = new Set([...library.playlistDao.listSyncKeys(account), ...library.playlistDao.listDismissedKeys(account)]);
    const linkedIds = new Set(
      library.playlistDao.list(account).flatMap((p) => (p.serverMylistId ? [p.serverMylistId] : []))
    );
    const adopted: Array<{ id: number; name: string }> = [];
    for (const m of await MyListClient.fetchOwnMylistsCompact()) {
      const key = extractPlaylistSyncKey(m.description);
      if (!key || known.has(key) || linkedIds.has(m.id)) continue;
      try {
        const pl = library.playlistDao.createLinked(account, m.name, m.id, key);
        known.add(key);
        adopted.push({ id: pl.id, name: pl.name });
        // 動画を取り込む (ローカルが空で基準も無いので、サーバー側の動画がそのまま入る)
        await mergePlaylistWithServer(m.id, playlistStore(pl.id)).catch((e) =>
          log.warn(`playlist adopt: initial sync failed (${m.id}):`, e)
        );
      } catch (e) {
        log.warn(`playlist adopt failed (${m.id}):`, e);
      }
    }
    return adopted;
  };
  ipcMain.handle(IpcChannel.PLAYLIST_ADOPT_SERVER, () => {
    // 画面の再描画などで続けて呼ばれても、同時に二重で取り込まない
    const account = AccountManager.key;
    let running = adopting.get(account);
    if (!running) {
      running = adoptServerPlaylists().finally(() => {
        adopting.delete(account);
      });
      adopting.set(account, running);
    }
    return running;
  });

  ipcMain.handle(IpcChannel.PLAYLIST_LIST_CONTAINING, (_e, videoId: string) => {
    return library.playlistDao.listPlaylistIdsForVideo(AccountManager.key, videoId);
  });

  // --- アカウント間のデータ移動・コピー (誤ったアカウントに紐づいたデータを直す) ---
  /** 録画予約の持ち主。account 未設定 (マルチアカウント導入前) は今のアカウント扱い */
  const reservationOwner = (r: { account?: string }): string => r.account ?? AccountManager.key;
  const countReservations = (account: string): number =>
    (getConfigStore().get('liveRecordReservations') ?? []).filter((r) => reservationOwner(r) === account).length;

  ipcMain.handle(IpcChannel.ACCOUNT_DATA_LIST, (): AccountDataEntry[] => {
    const ids = new Set(library.listAccountsWithData());
    for (const r of getConfigStore().get('liveRecordReservations') ?? []) ids.add(reservationOwner(r));
    return [...ids]
      .map((id) => ({ id, counts: { ...library.countAccountData(id), liveReservation: countReservations(id) } }))
      .filter((e) => e.counts.mylist + e.counts.playlist + e.counts.schedule + e.counts.liveReservation > 0);
  });

  ipcMain.handle(IpcChannel.ACCOUNT_DATA_TRANSFER, (_e, req: AccountDataTransferRequest): AccountDataCounts => {
    const registered = new Set(AccountManager.getState().accounts.map((a) => a.id));
    if (typeof req?.from !== 'string' || typeof req?.to !== 'string') throw new Error('移動元と移動先を指定してください');
    if (!req.to || !registered.has(req.to)) throw new Error('移動先は登録済みのアカウントを選んでください');
    if (req.from === req.to) throw new Error('移動元と移動先が同じです');
    if (req.mode !== 'move' && req.mode !== 'copy') throw new Error('移動かコピーかを選んでください');
    const { mylist, playlist, schedule, liveReservation } = req.kinds ?? ({} as AccountDataTransferRequest['kinds']);
    if (!mylist && !playlist && !schedule && !liveReservation) throw new Error('移すデータを選んでください');

    const done = library.transferAccountData(req.from, req.to, { mylist: !!mylist, playlist: !!playlist, schedule: !!schedule }, req.mode);
    let reservations = 0;
    if (liveReservation) {
      const store = getConfigStore();
      const all = store.get('liveRecordReservations') ?? [];
      const mine = all.filter((r) => reservationOwner(r) === req.from);
      const destIds = new Set(all.filter((r) => reservationOwner(r) === req.to).map((r) => r.programId));
      // 移動先に同じ番組の予約があればそちらを優先する
      const incoming = mine.filter((r) => !destIds.has(r.programId)).map((r) => ({ ...r, account: req.to }));
      const rest = req.mode === 'move' ? all.filter((r) => reservationOwner(r) !== req.from) : all;
      store.set('liveRecordReservations', [...rest, ...incoming].sort((a, b) => a.beginAtMs - b.beginAtMs));
      reservations = mine.length;
    }
    log.info(`account data ${req.mode}: ${req.from || '(未ログイン)'} -> ${req.to}`, { ...done, liveReservation: reservations });
    return { ...done, liveReservation: reservations };
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

  /** フォルダを src から dest へ移す (名前変更・移動の共通処理)。DB の動画パスも付け替える */
  const relocateFolder = async (src: string, dest: string): Promise<string> => {
    const fsmod = await import('node:fs');
    const root = path.resolve(library.videoDir);
    const inside = (p: string): boolean => {
      const rel = path.relative(root, path.resolve(p));
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    };
    if (!inside(src) || !inside(dest)) throw new Error('ライブラリの外のフォルダは移動できません');
    if (!fsmod.existsSync(src)) throw new Error('フォルダが見つかりません');
    const rel = path.relative(path.resolve(src), path.resolve(dest));
    if (rel === '' ) return dest;
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('フォルダを自分の中には移動できません');
    const caseOnly = src.toLowerCase() === dest.toLowerCase();
    if (!caseOnly && fsmod.existsSync(dest)) throw new Error('移動先にすでに同名のフォルダがあります');
    try {
      fsmod.renameSync(src, dest);
    } catch (e) {
      log.warn('folder relocate error:', src, '->', dest, e);
      throw new Error('フォルダを移動できませんでした。中のファイルを開いているアプリを閉じてから、もう一度試してください');
    }
    const n = library.videoDao.relocateFolder(src, dest);
    log.info(`folder relocated: ${src} -> ${dest} (${n} videos)`);
    // 付け替え漏れ (DB に載っていないファイルなど) があっても動画を見失わないよう、続けてライブラリを更新する
    try {
      await startScan({ full: false });
    } catch (e) {
      log.warn('scan after folder relocate failed:', e);
    }
    return dest;
  };

  ipcMain.handle(
    IpcChannel.LIBRARY_FOLDER_RENAME,
    async (_e, args: { path: string; newName: string }): Promise<string> => {
      const name = (args.newName ?? '').trim();
      if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
        throw new Error('フォルダ名に使えない文字が含まれています');
      }
      const dest = path.join(path.dirname(args.path), name);
      return relocateFolder(args.path, dest);
    }
  );

  ipcMain.handle(
    IpcChannel.LIBRARY_FOLDER_MOVE,
    async (_e, args: { path: string; targetParent: string | null }): Promise<string> => {
      const parent = args.targetParent ?? library.videoDir;
      const dest = path.join(parent, path.basename(args.path));
      return relocateFolder(args.path, dest);
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
