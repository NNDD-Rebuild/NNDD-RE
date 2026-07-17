import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ipcMain, dialog, shell, app, BrowserWindow, webContents, WebContentsView, nativeTheme, session } from 'electron';
import { IpcChannel } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { getConfigStore } from '../config/ConfigStore';
import {
  createLogger,
  readLogTail,
  clearLog,
  getLogFilePath,
  setLogLevel
} from '../util/Logger';
import {
  AuthManager,
  WatchInfoHandler,
  CommentClient,
  CommentXmlReader,
  SearchClient,
  MyListClient,
  RankingClient,
  ConnectionDiag,
  type SearchOptions
} from '../nicovideo';
import { NicoContext } from '../nicovideo/NicoContext';
import { NnddHttpServer } from '../server/NnddHttpServer';
import { LanLibraryClient } from '../server/LanLibraryClient';
import type { NgListItem } from '@shared/types';
import {
  DownloadManager,
  type EnqueueOptions
} from '../downloader/DownloadManager';
import { MyListAutoDownloader } from '../downloader/MyListAutoDownloader';
import { ScheduleManager } from '../downloader/ScheduleManager';
import type { Schedule } from '@shared/types';
import {
  PlayerManager,
  type OpenPlayerParams
} from '../player/PlayerManager';
import { buildLocalVideoUrl, autoConfigureAllowedRoots } from '../player/LocalVideoProtocol';
import { buildHlsProxyBase } from '../player/StreamServer';
import { encodeProxyUrl } from '../player/HlsProxy';
import { WatchSession } from '../nicovideo/video/WatchSession';
import type { WatchPageInfo } from '@shared/types';
import { CommentWindowManager } from '../player/CommentWindowManager';
import { BinaryInstaller } from '../util/BinaryInstaller';
import type { NNDDREComment } from '@shared/types';
import { YtDlpStreamer } from '../nicovideo/video/YtDlpStreamer';
import { LibraryScanner } from '../library/LibraryScanner';
import { TrayManager } from '../tray/TrayManager';
import { DownloadStatusType } from '@shared/types';
import { getUpdateManager } from '../update/UpdateManager';
import { ImageCache } from '../util/ImageCache';
import { GitHubAuthManager } from '../github/GitHubAuthManager';
import { GistClient } from '../github/GistClient';
import { BackupManager } from '../githubSync/BackupManager';
import type { DeviceFlowEvent, SyncProfile } from '@shared/types';

const log = createLogger('IPC');

/**
 * IPC ハンドラー登録。
 * 元: AS3 では各 Manager がアプリケーションオブジェクト経由でアクセスしていたが、
 * Electron では preload経由でメインプロセスに問い合わせる構造。
 */
export function registerIpcHandlers(
  library: LibraryManager,
  trayManager: TrayManager | null | undefined,
  mainWindowGetter: (() => BrowserWindow | null) | undefined,
  backupManager: BackupManager
): void {
  // --- ダウンロードマネージャ (シングルトン) ---
  const dlManager = new DownloadManager(library);
  const autoDl = new MyListAutoDownloader(library, dlManager);
  const scheduler = new ScheduleManager(library, autoDl);
  scheduler.start();

  // VIDEO_OPEN_PLAYER 時点でプリフェッチした WatchInfo を一時保持するキャッシュ
  const watchInfoPrefetchCache = new Map<string, Promise<WatchPageInfo>>();

  // 全レンダラーに進捗イベントをブロードキャスト
  dlManager.on('change', (item) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.DOWNLOAD_PROGRESS_EVENT, item);
    }
    // 完了通知
    if (item.status === DownloadStatusType.SUCCESS) {
      trayManager?.notify(
        'ダウンロード完了',
        item.videoName || item.videoId
      );
    } else if (item.status === DownloadStatusType.FAIL) {
      trayManager?.notify(
        'ダウンロード失敗',
        `${item.videoName || item.videoId}: ${item.errorMessage ?? ''}`
      );
    }
  });
  dlManager.on('changeAll', (items) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.DOWNLOAD_PROGRESS_EVENT, items);
    }
  });

  ipcMain.handle(IpcChannel.DOWNLOAD_LIST, () => dlManager.list());
  ipcMain.handle(IpcChannel.DOWNLOAD_ENQUEUE, (_e, opts: EnqueueOptions) =>
    dlManager.enqueue(opts)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_CANCEL, (_e, id: string) =>
    dlManager.cancel(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_REMOVE, (_e, id: string) =>
    dlManager.remove(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_RETRY, (_e, id: string) =>
    dlManager.retry(id)
  );
  ipcMain.handle(IpcChannel.DOWNLOAD_CLEAR_COMPLETED, () => {
    dlManager.clearCompleted();
    return true;
  });

  // --- スケジュール ---
  ipcMain.handle(IpcChannel.SCHEDULE_LIST, () => library.scheduleDao.list());
  ipcMain.handle(IpcChannel.SCHEDULE_ADD, (_e, s: Schedule) => {
    library.scheduleDao.upsert(s);
    return true;
  });
  ipcMain.handle(IpcChannel.SCHEDULE_UPDATE, (_e, s: Schedule) => {
    library.scheduleDao.upsert(s);
    return true;
  });
  ipcMain.handle(IpcChannel.SCHEDULE_REMOVE, (_e, id: string) => {
    library.scheduleDao.remove(id);
    return true;
  });

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
    const { VideoFileSuffix } = await import('@shared/constants');
    const video = library.videoDao.getById(id);
    if (video) {
      const dir = pmod.dirname(video.uri);
      const base = pmod.basename(video.uri).replace(/\.[^.]+$/, '');
      const targets = [
        video.uri,
        pmod.join(dir, `${base}${VideoFileSuffix.COMMENT_XML}`),
        pmod.join(dir, `${base}${VideoFileSuffix.OWNER_COMMENT_XML}`),
        pmod.join(dir, `${base}${VideoFileSuffix.THUMB_INFO_XML}`),
        pmod.join(dir, `${base}${VideoFileSuffix.THUMB_IMAGE}`),
        pmod.join(dir, `${base}${VideoFileSuffix.NOW_COMMENT_JSON}`),

        // [IchibaInfo].html は NNDD 互換用として削除しない
        // 旧形式互換
        pmod.join(dir, `${base}${VideoFileSuffix.INFO_TXT_LEGACY}`),
        pmod.join(dir, `${base}${VideoFileSuffix.OWNER_COMMENT_XML_LEGACY}`),
        pmod.join(dir, `${base}[コメント].xml`),
        pmod.join(dir, `${base}[投コメ].xml`),
        pmod.join(dir, `${base}[サムネイル情報].xml`),
        pmod.join(dir, `${base}[サムネイル].jpg`)
      ];
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
      }
    ) => {
      library.historyDao.add({
        videoId: item.videoId,
        title: item.title ?? item.videoId,
        thumbnailUrl: item.thumbnailUrl ?? '',
        watchedAt: new Date(),
        isLocal: Boolean(item.isLocal)
      });
      return true;
    }
  );

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

  // --- マイリスト (永続化分) ---
  ipcMain.handle(IpcChannel.MYLIST_LIST, () => {
    return library.myListDao.list();
  });

  // --- マイリスト (リモート取得) ---
  ipcMain.handle(IpcChannel.MYLIST_GET, async (_e, mylistId: string) => {
    return MyListClient.fetchPublicMylist(mylistId);
  });

  ipcMain.handle(IpcChannel.MYLIST_ADD, (_e, myList: import('@shared/types').MyList) => {
    library.myListDao.upsert(myList);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_REMOVE, (_e, url: string) => {
    library.myListDao.remove(url);
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_UPDATE_NAME, (_e, args: { url: string; name: string }) => {
    library.myListDao.updateName(args.url, args.name);
    return true;
  });

  ipcMain.handle(
    IpcChannel.MYLIST_RENEW,
    async (_e, mylistUrl: string) => {
      // mylistUrl から id を抽出
      const m = mylistUrl.match(/(?:mylist\/|^)(\d+)/);
      if (!m) throw new Error(`invalid mylist url: ${mylistUrl}`);
      const { items } = await MyListClient.fetchPublicMylist(m[1]);
      return items;
    }
  );

  ipcMain.handle(
    IpcChannel.MYLIST_FETCH_PAGE,
    async (_e, args: { url: string; page: number; pageSize?: number }) => {
      const m = args.url.match(/(?:mylist\/|^)(\d+)/);
      if (!m) throw new Error(`invalid mylist url: ${args.url}`);
      return MyListClient.fetchPublicMylist(m[1], args.page, args.pageSize ?? 100);
    }
  );

  ipcMain.handle(IpcChannel.MYLIST_FETCH_ACCOUNT, async () => {
    return MyListClient.fetchAccountMylists();
  });

  ipcMain.handle(IpcChannel.MYLIST_FETCH_INFO, async (_e, mylistId: string) => {
    const m = mylistId.match(/(?:mylist\/|^)(\d+)/);
    if (!m) return null;
    return MyListClient.fetchMylistInfo(m[1]);
  });

  ipcMain.handle(IpcChannel.SERIES_FETCH, async (_e, seriesId: string, currentVideoId?: string, requestedPage?: number) => {
    // seriesId は数字のみ、またはURL
    const m = (String(seriesId)).match(/series\/(\d+)/) ?? (String(seriesId)).match(/^(\d+)$/);
    if (!m) throw new Error(`invalid series id: ${seriesId}`);
    const id = m[1];
    const ctx = NicoContext.get();
    interface SeriesVideo {
      id: string;
      title: string;
      thumbnail?: { url?: string | { listingMedium?: string } };
      duration?: number;
      count?: { view?: number; comment?: number; mylist?: number; like?: number };
      registeredAt?: string;
    }
    interface SeriesRes {
      meta?: { status?: number };
      data?: {
        detail?: { title?: string; description?: string };
        totalCount?: number;
        items?: Array<{ video: SeriesVideo }>;
      };
    }
    const PAGE_SIZE = 100;
    const toLength = (sec: number): string => {
      const h = Math.floor(sec / 3600);
      const mm = Math.floor((sec % 3600) / 60);
      const ss = sec % 60;
      return h > 0
        ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
        : `${mm}:${String(ss).padStart(2, '0')}`;
    };
    const toThumb = (t: SeriesVideo['thumbnail']): string => {
      if (!t) return '';
      if (typeof t.url === 'string') return t.url;
      if (t.url && typeof t.url === 'object') return (t.url as { listingMedium?: string }).listingMedium ?? '';
      return '';
    };
    const mapItems = (items: Array<{ video: SeriesVideo }>) => items.map((i) => ({
      videoId: i.video.id,
      title: i.video.title,
      description: '',
      thumbnailUrl: toThumb(i.video.thumbnail),
      length: toLength(i.video.duration ?? 0),
      pubDate: i.video.registeredAt ?? new Date().toISOString(),
      viewCount: i.video.count?.view ?? 0,
      commentCount: i.video.count?.comment ?? 0,
      mylistCount: i.video.count?.mylist ?? 0,
      likeCount: i.video.count?.like ?? 0,
    }));
    const fetchPage = async (page: number) => {
      const url = `https://nvapi.nicovideo.jp/v2/series/${encodeURIComponent(id)}?pageSize=${PAGE_SIZE}&page=${page}`;
      log.debug('fetch series page %d:', page, url);
      return ctx.http.getJson<SeriesRes>(url);
    };
    const mkResult = (items: ReturnType<typeof mapItems>, name: string, page: number, totalPages: number) =>
      ({ name, items, page, totalPages });

    // ページ指定あり → そのページを直接取得
    if (requestedPage && requestedPage >= 1) {
      const res = await fetchPage(requestedPage);
      if (res.meta?.status && res.meta.status >= 400) {
        throw new Error(`シリーズ取得失敗: status=${res.meta.status}`);
      }
      const name = res.data?.detail?.title ?? `シリーズ ${id}`;
      const totalCount = res.data?.totalCount ?? 0;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
      return mkResult(mapItems(res.data?.items ?? []), name, requestedPage, totalPages);
    }

    // 初回ロード: ページ1取得 → currentVideoId のページを自動検出
    const firstRes = await fetchPage(1);
    if (firstRes.meta?.status && firstRes.meta.status >= 400) {
      throw new Error(`シリーズ取得失敗: status=${firstRes.meta.status}`);
    }
    const name = firstRes.data?.detail?.title ?? `シリーズ ${id}`;
    const firstItems = mapItems(firstRes.data?.items ?? []);
    const totalCount = firstRes.data?.totalCount ?? firstItems.length;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

    if (!currentVideoId || totalPages <= 1 || firstItems.some((i) => i.videoId === currentVideoId)) {
      return mkResult(firstItems, name, 1, totalPages);
    }

    // 現在の動画があるページを最終ページから逆順に探索
    for (let p = totalPages; p >= 2; p--) {
      const res = await fetchPage(p);
      const items = mapItems(res.data?.items ?? []);
      if (items.some((i) => i.videoId === currentVideoId)) {
        return mkResult(items, name, p, totalPages);
      }
    }

    return mkResult(firstItems, name, 1, totalPages);
  });

  ipcMain.handle(IpcChannel.MYLIST_ADD_VIDEO_DEFLIST, async (_e, videoId: string) => {
    const ctx = NicoContext.get();
    await ctx.http.postJson(
      'https://nvapi.nicovideo.jp/v1/users/me/watch-later',
      { watchId: videoId },
      { headers: { 'X-Frontend-Id': '6', 'X-Frontend-Version': '0', 'X-Request-With': 'https://www.nicovideo.jp' } }
    );
    return true;
  });

  ipcMain.handle(IpcChannel.MYLIST_RENEW_ALL, async () => {
    const mylists = library.myListDao.list();
    const results: Record<string, number> = {};
    for (const ml of mylists) {
      try {
        const m = ml.myListUrl.match(/(?:mylist\/|^)(\d+)/);
        if (!m) continue;
        const { items } = await MyListClient.fetchPublicMylist(m[1]);
        results[ml.myListUrl] = items.length;
        library.myListDao.upsert({ ...ml, unPlayVideoCount: 0 });
      } catch (e) {
        log.warn('mylist renew failed:', ml.myListUrl, e);
        results[ml.myListUrl] = -1;
      }
    }
    return results;
  });

  // --- 認証 ---
  ipcMain.handle(IpcChannel.AUTH_STATUS, async () => {
    return AuthManager.checkLoggedIn();
  });

  ipcMain.handle(IpcChannel.AUTH_OPEN_LOGIN_WINDOW, async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    return AuthManager.login(parent);
  });

  ipcMain.handle(
    IpcChannel.AUTH_LOGIN_FORM,
    async (_e, params: { email: string; password: string }) => {
      return AuthManager.loginWithCredentials(params.email, params.password);
    }
  );

  ipcMain.handle(
    IpcChannel.AUTH_LOGIN_MFA,
    async (_e, params: { mfaSubmitUrl: string; code: string }) => {
      return AuthManager.completeMfa(params.mfaSubmitUrl, params.code);
    }
  );

  ipcMain.handle(IpcChannel.AUTH_LOGOUT, async () => {
    await AuthManager.logout();
    return true;
  });

  ipcMain.handle(
    IpcChannel.AUTH_SAVE_CREDENTIALS,
    (_e, params: { email: string; password: string }) => {
      return AuthManager.saveCredentials(params.email, params.password);
    }
  );

  ipcMain.handle(IpcChannel.AUTH_CLEAR_CREDENTIALS, () => {
    AuthManager.clearCredentials();
  });

  ipcMain.handle(IpcChannel.AUTH_HAS_CREDENTIALS, () => {
    return AuthManager.hasCredentials();
  });

  ipcMain.handle(IpcChannel.AUTH_GET_SAVED_EMAIL, () => {
    return AuthManager.getSavedEmail();
  });

  ipcMain.handle(IpcChannel.AUTH_AUTO_RELOGIN, () => {
    return AuthManager.autoRelogin();
  });

  ipcMain.handle(IpcChannel.AUTH_LOGIN_WITH_SAVED, () => {
    return AuthManager.loginWithSavedCredentials();
  });

  // --- GitHub OAuth Device Flow ---
  GitHubAuthManager.events.on('event', (event: DeviceFlowEvent) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.GITHUB_DEVICE_FLOW_EVENT, event);
    }
  });

  ipcMain.handle(IpcChannel.GITHUB_STATUS, () => {
    return GitHubAuthManager.status();
  });

  ipcMain.handle(IpcChannel.GITHUB_START_DEVICE_FLOW, () => {
    return GitHubAuthManager.startDeviceFlow();
  });

  ipcMain.handle(IpcChannel.GITHUB_CANCEL_DEVICE_FLOW, () => {
    GitHubAuthManager.cancelDeviceFlow();
  });

  ipcMain.handle(IpcChannel.GITHUB_LOGOUT, () => {
    GitHubAuthManager.logout();
  });

  // --- バックアップ・同期 (GitHub Gist) ---
  ipcMain.handle(IpcChannel.BACKUP_LIST_PROFILES, () => {
    return backupManager.listProfiles();
  });

  ipcMain.handle(IpcChannel.BACKUP_GET_ACTIVE_PROFILE_ID, () => {
    return backupManager.getActiveProfileId();
  });

  ipcMain.handle(IpcChannel.BACKUP_ADD_PROFILE, (_e, name: string) => {
    return backupManager.addProfile(name);
  });

  ipcMain.handle(
    IpcChannel.BACKUP_UPDATE_PROFILE,
    (_e, id: string, patch: Partial<SyncProfile>) => {
      return backupManager.updateProfile(id, patch);
    }
  );

  ipcMain.handle(IpcChannel.BACKUP_REMOVE_PROFILE, (_e, id: string) => {
    backupManager.removeProfile(id);
  });

  ipcMain.handle(IpcChannel.BACKUP_SET_ACTIVE_PROFILE, (_e, id: string | null) => {
    backupManager.setActiveProfile(id);
  });

  ipcMain.handle(
    IpcChannel.BACKUP_LINK_EXISTING_GIST,
    (_e, profileId: string, gistId: string) => {
      return backupManager.linkExistingGist(profileId, gistId);
    }
  );

  ipcMain.handle(IpcChannel.BACKUP_LIST_CANDIDATE_GISTS, async () => {
    const token = GitHubAuthManager.getToken();
    if (!token) return [];
    const client = new GistClient(token);
    return client.listCandidates();
  });

  ipcMain.handle(IpcChannel.BACKUP_UPLOAD, async (_e, profileId: string) => {
    return backupManager.upload(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_DOWNLOAD, async (_e, profileId: string) => {
    return backupManager.download(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_PREVIEW, async (_e, profileId: string) => {
    return backupManager.preview(profileId);
  });

  // --- 動画 ---
  ipcMain.handle(IpcChannel.VIDEO_GET_WATCH_INFO, async (_e, videoId: string) => {
    const prefetched = watchInfoPrefetchCache.get(videoId);
    if (prefetched) {
      watchInfoPrefetchCache.delete(videoId);
      return prefetched;
    }
    return WatchInfoHandler.fetchWatchInfo(videoId);
  });

  ipcMain.handle(IpcChannel.VIDEO_GET_COMMENTS, async (_e, videoId: string, watchInfo?: WatchPageInfo) => {
    const watch = watchInfo ?? await WatchInfoHandler.fetchWatchInfo(videoId);
    return CommentClient.fetchComments(watch);
  });

  ipcMain.handle(
    IpcChannel.VIDEO_OPEN_PLAYER,
    async (_e, params: OpenPlayerParams) => {
      // streamUrl 指定 → LANライブラリのHTTPストリームをそのまま再生 (videoId不明のためレジューム対象外)
      if (params.streamUrl) {
        PlayerManager.get().open(params);
        return true;
      }

      const resume = params.videoId ? library.resumeDao.get(params.videoId) : null;
      const resumeSec = resume && resume.positionSec > 3 ? resume.positionSec : undefined;

      // videoId のみ指定 → ライブラリに DL 済みファイルがあればローカル再生を優先
      if (params.videoId && !params.localPath) {
        const video = library.videoDao.getByKey(params.videoId);
        if (video) {
          const fsmod = await import('node:fs');
          if (fsmod.existsSync(video.uri)) {
            log.verbose('VIDEO_OPEN_PLAYER: found in library, using local file', video.uri);
            PlayerManager.get().open({
              localPath: video.uri,
              videoId: params.videoId,
              searchPlaylist: params.searchPlaylist,
              autoNext: params.autoNext,
              audioOnly: params.audioOnly,
              resumeSec,
            });
            return true;
          }
        }
      }
      // BrowserWindow生成と並列でWatchInfo取得を開始（レンダラー準備完了前に先行）
      if (params.videoId) {
        watchInfoPrefetchCache.set(
          params.videoId,
          WatchInfoHandler.fetchWatchInfo(params.videoId)
        );
      }
      PlayerManager.get().open({ ...params, resumeSec });
      return true;
    }
  );

  // ローカル動画ファイル用 URL を生成 (custom protocol)
  ipcMain.handle(IpcChannel.VIDEO_BUILD_LOCAL_URL, (_e, absolutePath: string) => {
    return buildLocalVideoUrl(absolutePath);
  });

  // ストリーミング再生。
  // streamingMode:
  //   'native':   hls.js でニコニコCDNに直接アクセス (session.webRequest でCookie/CORS処理)
  //   'hls':      HLS プロキシで即時再生 (StreamServer+HlsProxy 経由、URL書き換えのみ)
  //   'niconico': 公式プレイヤー webview 埋め込み
  ipcMain.handle(IpcChannel.VIDEO_GET_STREAM_URL, async (_e, videoId: string, watchInfo?: WatchPageInfo, audioOnly?: boolean, videoQualityId?: string) => {
    const mode = getConfigStore().get('player').streamingMode ?? 'native';

    // --- niconico モード ---
    if (mode === 'niconico') {
      if (audioOnly) return { contentUrl: null, isDMS: false, error: 'niconico モードでは音声のみ再生に非対応です' };
      return { contentUrl: null, isDMS: false, niconico: true };
    }

    // キャッシュ済みならローカル即再生 (どのモードでも共通)
    const cachedPath = YtDlpStreamer.getCachedPath(videoId);
    if (cachedPath) {
      log.verbose('cache: reuse local file', cachedPath);
      return { contentUrl: buildLocalVideoUrl(cachedPath), isDMS: false };
    }

    // --- native モード: hls.js でニコニコCDNに直接アクセス ---
    if (mode === 'native') {
      let session: { contentUrl: string; isDMS: boolean };
      try {
        session = await ensureStreamSession(videoId, watchInfo, audioOnly, videoQualityId);
      } catch (e) {
        return { contentUrl: null, isDMS: false, error: String(e) };
      }
      log.verbose('native: direct stream', videoId, audioOnly ? '(audioOnly)' : '', '→', session.contentUrl.slice(0, 80));
      return { contentUrl: session.contentUrl, isDMS: session.isDMS, isHls: true };
    }

    // --- hls モード: HLS プロキシで即時再生 (yt-dlp ベース) ---
    if (mode === 'hls') {
      let session: { contentUrl: string; isDMS: boolean };
      try {
        session = await ensureStreamSession(videoId, watchInfo, audioOnly, videoQualityId);
      } catch (e) {
        return { contentUrl: null, isDMS: false, error: String(e) };
      }
      const proxyBase = buildHlsProxyBase(videoId);
      const proxyMasterUrl = encodeProxyUrl(session.contentUrl, 'm3u8', proxyBase);
      log.verbose('hls: proxy start', videoId, audioOnly ? '(audioOnly)' : '', '→', proxyMasterUrl.slice(0, 80));
      return { contentUrl: proxyMasterUrl, isDMS: session.isDMS, isHls: true };
    }

    return { contentUrl: null, isDMS: false, error: 'unsupported streaming mode' };
  });

  // --- 検索 ---
  ipcMain.handle(IpcChannel.SEARCH_EXECUTE, async (_e, opts: SearchOptions) => {
    return SearchClient.search(opts);
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_LIST, () => {
    return library.searchDao.list();
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_ADD, (_e, item) => {
    library.searchDao.upsert(item);
    return true;
  });

  ipcMain.handle(IpcChannel.SEARCH_SAVED_REMOVE, (_e, id: string) => {
    library.searchDao.remove(id);
    return true;
  });

  // --- ランキング ---
  ipcMain.handle(
    IpcChannel.RANKING_FETCH,
    async (_e, opts: { genre: string; term: 'hour' | '24h' | 'week' | 'month' | 'total' }) => {
      return RankingClient.fetch(opts.genre, opts.term);
    }
  );

  // --- 設定 ---
  ipcMain.handle(IpcChannel.CONFIG_GET_ALL, () => {
    return getConfigStore().store;
  });

  ipcMain.handle(IpcChannel.CONFIG_GET, (_e, key: string) => {
    return getConfigStore().get(key as never);
  });

  ipcMain.handle(IpcChannel.CONFIG_SET, (e, key: string, value: unknown) => {
    getConfigStore().set(key as never, value as never);
    if (key === 'ui.theme') {
      const bgColor = value === 'light' ? '#f0f0f0' : '#1e1e1e';
      BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(bgColor);
      nativeTheme.themeSource = value === 'light' ? 'light' : 'dark';
    }
    if (key === 'logLevel') {
      setLogLevel(value as 'standard' | 'verbose');
    }
    if (key === 'libraryRoot') {
      const dir = typeof value === 'string' && value ? value : library.defaultVideoDir;
      library.videoDir = dir;
      fs.mkdirSync(dir, { recursive: true });
      const cacheRoot = getConfigStore().get('cacheRoot');
      const extraPaths = [library.libraryDir, library.rootDir, dir];
      if (cacheRoot) extraPaths.push(path.join(String(cacheRoot), 'cache', 'movie'));
      autoConfigureAllowedRoots(extraPaths);
    }
    return true;
  });

  // --- システム ---
  ipcMain.handle(IpcChannel.SYS_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IpcChannel.SYS_GET_APP_INFO, () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    libraryRoot: library.rootDir,
    dbPath: path.join(library.systemDir, 'library.db'),
    cookiePath: path.join(library.systemDir, 'cookies.json'),
    logPath: getLogFilePath(),
    cacheDir: YtDlpStreamer.cacheDir(),
  }));

  ipcMain.handle(
    IpcChannel.SYS_CHOOSE_DIRECTORY,
    async (e, defaultPath?: string) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    IpcChannel.SYS_CHOOSE_FILE,
    async (e, filters?: Electron.FileFilter[]) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openFile'],
        filters
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(IpcChannel.SYS_OPEN_PATH, async (_e, p: string) => {
    return shell.openPath(p);
  });

  // --- NGリスト ---
  ipcMain.handle(IpcChannel.NG_LIST_COMMENT, () =>
    library.ngListDao.listComment()
  );
  ipcMain.handle(IpcChannel.NG_ADD_COMMENT, (_e, item: NgListItem) => {
    library.ngListDao.addComment(item);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_COMMENT, (_e, item: NgListItem) => {
    library.ngListDao.removeComment(item);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_LIST_TAG, () => library.ngListDao.listTags());
  ipcMain.handle(IpcChannel.NG_ADD_TAG, (_e, tag: string) => {
    library.ngListDao.addTag(tag);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_TAG, (_e, tag: string) => {
    library.ngListDao.removeTag(tag);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_LIST_UP, () => library.ngListDao.listUps());
  ipcMain.handle(IpcChannel.NG_ADD_UP, (_e, userId: string) => {
    library.ngListDao.addUp(userId);
    return true;
  });
  ipcMain.handle(IpcChannel.NG_REMOVE_UP, (_e, userId: string) => {
    library.ngListDao.removeUp(userId);
    return true;
  });

  // --- ローカルコメント読み込み ---
  ipcMain.handle(IpcChannel.COMMENT_READ_LOCAL, (_e, filePath: string) => {
    return CommentXmlReader.readFile(filePath);
  });

  ipcMain.handle(IpcChannel.COMMENT_NOW_IDS_READ, (_e, filePath: string) => {
    const fsmod = require('node:fs') as typeof import('node:fs');
    if (!fsmod.existsSync(filePath)) return [];
    try {
      return JSON.parse(fsmod.readFileSync(filePath, 'utf-8')) as number[];
    } catch {
      return [];
    }
  });

  // --- 過去コメント ---
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_FETCH,
    async (e, videoId: string, whenUnixSec: number, maxCount?: number) => {
      const watch = await WatchInfoHandler.fetchWatchInfo(videoId);
      return CommentClient.fetchAllComments(watch, {
        startWhenUnixSec: whenUnixSec,
        maxTotalCount: maxCount ?? 10_000,
        includeEasy: false,
        comment429RetryWaitSec: getConfigStore().get('comment429RetryWaitSec') ?? 60,
        onProgress: (msg) => {
          if (!e.sender.isDestroyed()) e.sender.send(IpcChannel.PAST_COMMENT_FETCH_PROGRESS, msg);
        }
      });
    }
  );
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_FETCH_LOCAL,
    (_e, filePath: string, whenUnixSec: number, fromUnixSec: number = 0) => {
      const all = CommentXmlReader.readFile(filePath);
      return all.filter(
        (c) =>
          (!fromUnixSec || c.date >= fromUnixSec) &&
          (!whenUnixSec || c.date <= whenUnixSec)
      );
    }
  );

  // --- 過去コメント差分取得・ローカルXMLにマージ保存 ---
  ipcMain.handle(
    IpcChannel.PAST_COMMENT_REFETCH,
    async (_e, videoId: string, xmlPath: string) => {
      const { LocalFileHandler } = await import('../nicovideo/video/LocalFileHandler');
      const watch = await WatchInfoHandler.fetchWatchInfo(videoId);
      const fresh = await CommentClient.fetchAllComments(watch);

      // 既存XMLを読んで重複排除
      const existing = CommentXmlReader.readFile(xmlPath);
      const existingKeys = new Set(existing.map((c) => `${c.thread}:${c.no}`));
      const diff = fresh.filter((c) => !existingKeys.has(`${c.thread}:${c.no}`));

      if (diff.length > 0) {
        const merged = [...existing, ...diff];
        const threadId =
          watch.commentThreads.find((t) => t.fork === 'main')?.id ??
          watch.commentThreads[0]?.id ??
          '';
        LocalFileHandler.writeCommentXml(
          xmlPath,
          merged.filter((c) => c.fork !== 'owner'),
          threadId,
          videoId,
          'main'
        );
        log.verbose(`PAST_COMMENT_REFETCH: +${diff.length} new comments`);
      }
      return { added: diff.length };
    }
  );

  // --- ローカル ThumbInfo XML 読み込み (旧 info.txt にも後方互換フォールバック) ---
  ipcMain.handle(IpcChannel.THUMB_INFO_XML_READ, async (_e, filePath: string) => {
    const { ThumbInfoXmlReader } = await import('../nicovideo/video/ThumbInfoXmlReader');
    const parsed = ThumbInfoXmlReader.parseFile(filePath);
    if (parsed) return ThumbInfoXmlReader.toWatchPageInfo(parsed);
    // 後方互換: [info].txt
    const legacyPath = filePath.replace('[ThumbInfo].xml', '[info].txt');
    const { InfoTxtReader } = await import('../nicovideo/video/InfoTxtReader');
    const legacy = InfoTxtReader.parseFile(legacyPath);
    if (!legacy) return null;
    return InfoTxtReader.toWatchPageInfo(legacy);
  });

  // --- 再生回数カウントアップ ---
  ipcMain.handle(IpcChannel.VIDEO_INCREMENT_PLAY_COUNT, (_e, videoId: string) => {
    library.videoDao.incrementPlayCount(videoId);
    return true;
  });

  // --- キャッシュ削除 (再生エラー時のフォールバック用) ---
  ipcMain.handle(IpcChannel.VIDEO_DELETE_CACHE, (_e, videoId: string) => {
    const cached = YtDlpStreamer.getCachedPath(videoId);
    if (cached) {
      try { fs.unlinkSync(cached); log.verbose('cache deleted:', cached); } catch (e) { log.warn('cache delete failed:', e); }
    }
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

  // --- 接続診断 ---
  ipcMain.handle(IpcChannel.DIAG_RUN, async () => {
    return ConnectionDiag.runAll();
  });

  // --- HTTPサーバー制御 ---
  let runtimeHttpServer: NnddHttpServer | null = null;

  // 自動起動
  if (getConfigStore().get('httpServer').enabled) {
    runtimeHttpServer = new NnddHttpServer(library);
    runtimeHttpServer.start().then(({ port }) => {
      log.info('HTTP server auto-started on port', port);
    }).catch((e) => {
      log.warn('HTTP server auto-start failed:', e);
      runtimeHttpServer = null;
    });
  }

  ipcMain.handle(IpcChannel.HTTPD_START, async () => {
    if (runtimeHttpServer) return { port: runtimeHttpServer.getPort(), running: true };
    runtimeHttpServer = new NnddHttpServer(library);
    const { port } = await runtimeHttpServer.start();
    return { port, running: true };
  });
  ipcMain.handle(IpcChannel.HTTPD_STOP, async () => {
    if (runtimeHttpServer) {
      await runtimeHttpServer.stop();
      runtimeHttpServer = null;
    }
    return { running: false };
  });
  ipcMain.handle(IpcChannel.HTTPD_STATUS, () => {
    if (runtimeHttpServer) {
      const port = runtimeHttpServer.getPort();
      let lanIp: string | undefined;
      if (runtimeHttpServer.getAllowExternal()) {
        lanIp = getLanIp();
      }
      return { running: true, port, lanIp };
    }
    return { running: false };
  });

  // --- LANライブラリ (本家NNDD互換クライアント) ---
  ipcMain.handle(IpcChannel.LAN_STATUS, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return { reachable: false };
    const client = new LanLibraryClient(cfg.address, cfg.port);
    const reachable = await client.ping();
    return { reachable };
  });

  ipcMain.handle(IpcChannel.LAN_LIBRARY_LIST, async () => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return [];
    const client = new LanLibraryClient(cfg.address, cfg.port);
    return await client.getVideoIdList();
  });

  ipcMain.handle(IpcChannel.LAN_VIDEO_STREAM, async (_e, videoId: string) => {
    const cfg = getConfigStore().get('remoteNndd');
    if (!cfg.enabled || !cfg.address) return null;
    const client = new LanLibraryClient(cfg.address, cfg.port);
    return await client.getVideoById(videoId);
  });

  // --- ログ ---
  ipcMain.handle(IpcChannel.LOG_READ, (_e, bytes?: number) =>
    readLogTail(bytes ?? 64 * 1024)
  );
  ipcMain.handle(IpcChannel.LOG_CLEAR, () => {
    clearLog();
    return true;
  });
  ipcMain.handle(IpcChannel.LOG_GET_PATH, () => getLogFilePath());

  // --- 自動更新 ---
  ipcMain.handle(IpcChannel.UPDATE_CHECK, async () => {
    return getUpdateManager().check();
  });
  ipcMain.handle(IpcChannel.UPDATE_DOWNLOAD, async () => {
    return getUpdateManager().download();
  });
  ipcMain.handle(IpcChannel.UPDATE_INSTALL, () => {
    getUpdateManager().install();
    return true;
  });

  // niconicoモード: WebContentsView管理 (windowごとに1つ)
  interface NicoBounds { x: number; y: number; width: number; height: number }
  interface NiconicoEntry { view: WebContentsView; bounds: NicoBounds | null }
  const niconicoViews = new Map<number, NiconicoEntry>();

  // プレイヤー要素に合わせてzoom + view位置オフセットでヘッダーをウィンドウ外へ追い出す
  // PlayerPresenter は React SPA が後から注入するため、最大 retries 回リトライする
  const fitPlayerToView = async (entry: NiconicoEntry, retries = 8, delayMs = 1500): Promise<void> => {
    if (!entry.bounds || entry.bounds.width <= 0) return;
    try {
      const rect = await entry.view.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('[class*="PlayerPresenter"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          // プレイヤー要素本体の幅（zoom 反映前）
          const nativeWidth = el.scrollWidth || el.offsetWidth;
          return {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            w: r.width,
            h: r.height,
            nativeW: nativeWidth
          };
        })()
      `);
      if (!rect || rect.nativeW <= 0) {
        // 要素未生成 → リトライ
        if (retries > 0) {
          setTimeout(() => { void fitPlayerToView(entry, retries - 1, delayMs); }, delayMs);
        }
        return;
      }
      const { x, y, width, height } = entry.bounds;
      const MARGIN = 8;
      const LEFT_MARGIN = -30; // 左側マージン調整: 0 = 詰まる、正数で右に移動、負数で左に詰まる
      // プレイヤー要素本体がコンテナにぴったり収まるように zoom を計算
      // zoomScale: 1.0 = 標準、0.9 = 10%小さく、1.1 = 10%大きく
      const zoomScale = 0.97;
      const zoom = ((width - MARGIN) / rect.nativeW) * zoomScale;
      entry.view.webContents.setZoomFactor(zoom);
      // プレイヤー右端をdiv右端に揃える
      const xOff = Math.max(0, Math.round((rect.x + rect.w) * zoom - width) - LEFT_MARGIN);
      const yOff = Math.round(rect.y * zoom);
      log.verbose('fitPlayerToView:', {
        'nativeW (player)': rect.nativeW,
        'entry.bounds.width': width,
        'baseZoom': (width - MARGIN) / rect.nativeW,
        'zoomScale': zoomScale,
        'calculatedZoom': zoom
      });
      entry.view.setBounds({ x: x - xOff, y: y - yOff, width: width + xOff, height: height + yOff });
    } catch (e) { log.error('fitPlayerToView error:', e); }
  };

  ipcMain.on(IpcChannel.PLAYER_NICONICO_INIT, (e, { videoId }: { videoId: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const existing = niconicoViews.get(win.id);
    if (existing) {
      try { win.contentView.removeChildView(existing.view); } catch {}
      existing.view.webContents.close();
    }
    const view = new WebContentsView({
      webPreferences: { partition: 'persist:niconico', contextIsolation: true }
    });
    const entry: NiconicoEntry = { view, bounds: null };
    win.contentView.addChildView(view);

    // NicoContext の Cookie (user_session 等) を persist:niconico session に注入してログイン状態を引き継ぐ
    void (async (): Promise<void> => {
      try {
        const ctx = NicoContext.get();
        const nicoSes = session.fromPartition('persist:niconico');
        const cookies = await ctx.cookieStore.rawJar.getCookies('https://www.nicovideo.jp/');
        for (const c of cookies) {
          await nicoSes.cookies.set({
            url: 'https://www.nicovideo.jp',
            name: c.key,
            value: c.value,
            domain: c.domain ?? '.nicovideo.jp',
            path: c.path ?? '/',
            secure: Boolean(c.secure),
            httpOnly: Boolean(c.httpOnly),
            ...(c.expires && c.expires !== 'Infinity'
              ? { expirationDate: Math.floor((c.expires instanceof Date ? c.expires : new Date(c.expires as string)).getTime() / 1000) }
              : {})
          });
        }
      } catch (e) {
        log.warn('PLAYER_NICONICO_INIT: cookie injection failed:', e);
      }
    })();

    // did-finish-load 後もSPAの遅延レンダリングがあるので1.5s遅らせてリトライ開始
    view.webContents.on('did-finish-load', () => {
      setTimeout(() => { void fitPlayerToView(entry); }, 1500);
    });
    view.webContents.loadURL(`https://www.nicovideo.jp/watch/${videoId}`);
    niconicoViews.set(win.id, entry);

    // niconicoプレイヤー内の requestFullscreen() を拾ってviewをリサイズ
    view.webContents.on('enter-html-full-screen', () => {
      const [w, h] = win.getContentSize();
      view.setBounds({ x: 0, y: 0, width: w, height: h });
      e.sender.send(IpcChannel.PLAYER_NICONICO_FULLSCREEN, true);
    });
    view.webContents.on('leave-html-full-screen', () => {
      // 元のboundsに戻す
      if (entry.bounds) view.setBounds(entry.bounds);
      e.sender.send(IpcChannel.PLAYER_NICONICO_FULLSCREEN, false);
    });

    // ウィンドウ × 閉じ時に WebContentsView を確実に破棄 (音が残るのを防ぐ)
    win.once('closed', () => {
      try { entry.view.webContents.close(); } catch {}
      niconicoViews.delete(win.id);
    });
  });

  ipcMain.on(IpcChannel.PLAYER_NICONICO_RESIZE, (e, bounds: NicoBounds) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const entry = niconicoViews.get(win.id);
    if (entry && bounds.width > 0 && bounds.height > 0) {
      entry.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      // 初期配置はdiv境界そのまま (fitPlayerToViewで補正される)
      entry.view.setBounds(entry.bounds);
      void fitPlayerToView(entry);
    }
  });

  ipcMain.on(IpcChannel.PLAYER_NICONICO_DESTROY, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const entry = niconicoViews.get(win.id);
    if (entry) {
      try { win.contentView.removeChildView(entry.view); } catch {}
      entry.view.webContents.close();
      niconicoViews.delete(win.id);
    }
  });

  // --- コメントウィンドウ ---
  const commentWinMgr = CommentWindowManager.get();

  ipcMain.handle(
    IpcChannel.COMMENT_WINDOW_OPEN,
    (
      event,
      data: { videoId: string; title: string; comments: NNDDREComment[]; localCommentXmlPath?: string; ichibaHtmlPath?: string }
    ) => {
      const playerWin = BrowserWindow.fromWebContents(event.sender);
      if (!playerWin) return;
      commentWinMgr.open(playerWin, data);
    }
  );

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_PUSH,
    (_e, comments: NNDDREComment[]) => {
      commentWinMgr.pushComments(comments);
    }
  );

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_TIME,
    (_e, timeSec: number) => {
      commentWinMgr.pushTime(timeSec);
    }
  );

  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_SEEK,
    (_e, timeSec: number) => {
      commentWinMgr.relaySeek(timeSec);
    }
  );

  // コメントウィンドウ → プレイヤー: 過去コメント配列中継
  ipcMain.on(
    IpcChannel.COMMENT_WINDOW_PAST_PUSH,
    (_e, comments: NNDDREComment[] | null) => {
      commentWinMgr.relayPastComments(comments);
    }
  );

  // --- 内蔵ブラウザウィンドウで開く ---
  ipcMain.handle(IpcChannel.SYS_OPEN_IN_BROWSER, (_e, url: string) => {
    const browserWin = new BrowserWindow({
      width: 960,
      height: 720,
      title: url,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    if (url.startsWith('file://') || url.startsWith('/') || /^[A-Za-z]:[/\\]/.test(url)) {
      void browserWin.loadURL(`file:///${url.replace(/\\/g, '/').replace(/^\/+/, '')}`);
    } else {
      void browserWin.loadURL(url);
    }
    browserWin.show();
    return true;
  });

  // --- ストリームキャッシュ管理 ---
  ipcMain.handle(IpcChannel.CACHE_INFO, () => {
    const dir = YtDlpStreamer.cacheDir();
    const sizeBytes = YtDlpStreamer.cacheSizeBytes();
    const fsmod = require('node:fs') as typeof import('node:fs');
    const fileCount = (() => {
      try { return fsmod.readdirSync(dir).length; } catch { return 0; }
    })();
    return { sizeBytes, fileCount, dir };
  });

  ipcMain.handle(IpcChannel.CACHE_CLEAR, () => {
    YtDlpStreamer.cleanupAll();
    return true;
  });

  ipcMain.handle(IpcChannel.CACHE_SET_DIR, (_e, newDir: string) => {
    getConfigStore().set('cacheRoot', newDir);
    return true;
  });

  // --- フォロー中フィード ---
  ipcMain.handle(
    IpcChannel.FOLLOW_FEED,
    async (_e, opts?: { limit?: number; untilId?: string; pageNum?: number; userId?: string; userNickname?: string; userIconUrl?: string }) => {
      const { FollowFeedClient } = await import('../nicovideo/follow/FollowFeedClient');
      const user = opts?.userId
        ? { id: opts.userId, nickname: opts.userNickname ?? opts.userId, iconUrl: opts.userIconUrl ?? '' }
        : undefined;
      return FollowFeedClient.fetchFeed(opts?.limit ?? 32, opts?.untilId, user, opts?.pageNum ?? 1);
    }
  );

  ipcMain.handle(IpcChannel.FOLLOW_PROBE, async () => {
    const { FollowFeedClient } = await import('../nicovideo/follow/FollowFeedClient');
    return FollowFeedClient.probeEndpoints();
  });

  ipcMain.handle(IpcChannel.FOLLOW_USERS, async () => {
    const { FollowFeedClient } = await import('../nicovideo/follow/FollowFeedClient');
    return FollowFeedClient.fetchUsers(100);
  });

  // プレイヤーウィンドウ → メインウィンドウへのナビゲーション
  ipcMain.handle(IpcChannel.NAV_MYLIST, (_e, mylistId: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      // メインウィンドウをフォアグラウンドに出してナビゲーション
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_MYLIST, mylistId);
    } else {
      // フォールバック: 全ウィンドウに送信
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_MYLIST, mylistId);
        }
      }
    }
  });

  ipcMain.handle(IpcChannel.IMAGE_FETCH, async (_e, url: string) => {
    if (!url) return url;
    const ctx = NicoContext.get();
    return ImageCache.getOrFetch(url, ctx.http);
  });

  // 画像キャッシュ操作
  ipcMain.handle(IpcChannel.IMAGE_CACHE_INFO, () => {
    return ImageCache.info();
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_CLEAR, () => {
    ImageCache.clear();
    return true;
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_ENABLED_SET, (_e, enabled: boolean) => {
    ImageCache.setEnabled(enabled);
    getConfigStore().set('imageCache.enabled', enabled);
    return true;
  });
  ipcMain.handle(IpcChannel.IMAGE_CACHE_MAX_SIZE_SET, (_e, maxSizeMb: number) => {
    ImageCache.setMaxSizeMb(maxSizeMb);
    getConfigStore().set('imageCache.maxSizeMb', maxSizeMb);
    return true;
  });

  // ユーザーアイコンURL取得 (nvapi /v1/users/{userId})
  ipcMain.handle(IpcChannel.USER_ICON_FETCH, async (_e, userId: string | number) => {
    try {
      const ctx = NicoContext.get();
      const url = `https://nvapi.nicovideo.jp/v1/users/${encodeURIComponent(String(userId))}`;
      interface UserRes {
        meta?: { status?: number };
        data?: { user?: { icons?: { small?: string; large?: string } } };
      }
      const res = await ctx.http.getJson<UserRes>(url, { timeoutMs: 8000 });
      return res.data?.user?.icons?.small ?? null;
    } catch {
      return null;
    }
  });

  // プレイヤーウィンドウ → メインウィンドウへのシリーズナビゲーション
  ipcMain.handle(IpcChannel.NAV_SERIES, (_e, seriesId: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_SERIES, seriesId);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_SERIES, seriesId);
        }
      }
    }
  });

  ipcMain.handle(IpcChannel.NAV_SEARCH_TAG, (_e, tag: string) => {
    const mainWin = mainWindowGetter?.();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send(IpcChannel.NAV_SEARCH_TAG, tag);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.NAV_SEARCH_TAG, tag);
        }
      }
    }
  });

  // プレイヤーウィンドウ → メインウィンドウへのフォローユーザーナビゲーション
  ipcMain.handle(
    IpcChannel.NAV_FOLLOW_USER,
    (_e, payload: { userId: string; nickname: string; iconUrl: string }) => {
      const mainWin = mainWindowGetter?.();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show();
        mainWin.focus();
        mainWin.webContents.send(IpcChannel.NAV_FOLLOW_USER, payload);
      } else {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(IpcChannel.NAV_FOLLOW_USER, payload);
          }
        }
      }
    }
  );

  // ライブラリ フォルダ操作
  ipcMain.handle(IpcChannel.LIBRARY_CHECK_BATCH, (_e, videoIds: string[]) => {
    const root = path.resolve(library.videoDir);
    return videoIds.filter((id) => {
      const v = library.videoDao.getByKey(id);
      if (!v) return false;
      const rel = path.relative(root, path.resolve(v.uri));
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });
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
      const { VideoFileSuffix } = await import('@shared/constants');
      const suffixes = [
        '',
        VideoFileSuffix.COMMENT_XML,
        VideoFileSuffix.OWNER_COMMENT_XML,
        VideoFileSuffix.THUMB_INFO_XML,
        VideoFileSuffix.THUMB_IMAGE,
        VideoFileSuffix.INFO_TXT_LEGACY,
        VideoFileSuffix.OWNER_COMMENT_XML_LEGACY,
        '[コメント].xml',
        '[投コメ].xml',
        '[サムネイル情報].xml',
        '[サムネイル].jpg',
      ];
      for (const id of videoIds) {
        const video = library.videoDao.getById(id);
        if (!video) continue;
        const dir = pmod.dirname(video.uri);
        const base = pmod.basename(video.uri).replace(/\.[^.]+$/, '');
        const ext = video.uri.match(/\.[^.]+$/)?.[0] ?? '.mp4';

        for (const suf of suffixes) {
          const src = suf === '' ? video.uri : pmod.join(dir, `${base}${suf}`);
          if (!fsmod.existsSync(src)) continue;
          const destName = suf === '' ? pmod.basename(video.uri) : `${base}${suf}`;
          const dest = pmod.join(targetFolder, destName);
          try { fsmod.renameSync(src, dest); } catch (e) { log.warn('move error:', src, '->', dest, e); }
        }
        // DBのuriを更新
        const newUri = pmod.join(targetFolder, pmod.basename(video.uri));
        library.videoDao.updateUri(id, newUri);
        void ext; // suppress unused warning
      }
      return true;
    }
  );

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_LIST, async () => {
    const fsmod = await import('node:fs');
    const pmod = await import('node:path');
    const root = library.videoDir;
    if (!fsmod.existsSync(root)) return [];
    try {
      return fsmod.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => pmod.join(root, e.name));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IpcChannel.LIBRARY_FOLDER_DELETE, async (_e, folderPath: string) => {
    const fsmod = await import('node:fs');
    // DB から該当フォルダの動画を削除
    const videos = library.videoDao.listWithTags().filter((v) => {
      const d = v.uri.replace(/[/\\][^/\\]+$/, '');
      return d === folderPath;
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
      return fsmod.readdirSync(folderPath)
        .filter((name) => VIDEO_EXTS.has(pmod.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, 'ja'))
        .map((name) => pmod.join(folderPath, name));
    } catch {
      return [];
    }
  });

  // バイナリ管理
  ipcMain.handle(IpcChannel.BINARY_STATUS, async () => {
    const [ytDlp, ffmpeg] = await Promise.all([
      BinaryInstaller.checkYtDlp(),
      BinaryInstaller.checkFfmpeg(),
    ]);
    return {
      ytDlp, ffmpeg,
      canAutoInstallFfmpeg: BinaryInstaller.canAutoInstallFfmpeg(),
      hasWinget: await BinaryInstaller.checkWinget(),
      platform: process.platform,
      localPaths: {
        ytDlp: BinaryInstaller.ytDlpLocalPath(),
        ffmpeg: BinaryInstaller.ffmpegLocalPath(),
      }
    };
  });

  ipcMain.handle(IpcChannel.BINARY_INSTALL_YT_DLP, async (event) => {
    const status = await BinaryInstaller.checkYtDlp();
    await BinaryInstaller.installYtDlp(status.found, (pct) => {
      event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'yt-dlp', pct });
    });
  });

  ipcMain.handle(IpcChannel.BINARY_INSTALL_FFMPEG, async (event) => {
    const status = await BinaryInstaller.checkFfmpeg();
    await BinaryInstaller.installFfmpegSuite(status.found, (pct) => {
      event.sender.send(IpcChannel.BINARY_INSTALL_PROGRESS, { tool: 'ffmpeg', pct });
    });
  });

  // ウィンドウ制御 (カスタムタイトルバー)
  ipcMain.handle(IpcChannel.WIN_IS_MAXIMIZED, () => mainWindowGetter?.()?.isMaximized() ?? false);
  ipcMain.on(IpcChannel.WIN_MINIMIZE, () => mainWindowGetter?.()?.minimize());
  ipcMain.on(IpcChannel.WIN_MAXIMIZE_TOGGLE, () => {
    const win = mainWindowGetter?.();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on(IpcChannel.WIN_CLOSE, () => mainWindowGetter?.()?.close());

  // セッションチェック。切れていたら自動再ログイン、失敗時はrendererに通知。
  // 起動直後に1回 + 以後30分ごと (起動直後チェックがないと、数日放置後の起動でセッション切れに
  // 気付かないまま最初の動画再生を試みて失敗する)
  const checkSession = (): void => {
    void (async (): Promise<void> => {
      if (AuthManager.isLoggedOut) return;
      try {
        const ok = await AuthManager.checkLoggedIn();
        if (ok) return;
        const result = await AuthManager.autoRelogin();
        if (result.ok) {
          log.info('session expired, auto relogin succeeded');
          return;
        }
        if (result.noCredentials) return;
        const mainWin = mainWindowGetter?.();
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send(IpcChannel.AUTH_SESSION_EXPIRED, {
            mfaRequired: result.mfaRequired,
            mfaSubmitUrl: result.mfaSubmitUrl
          });
        }
      } catch (e) {
        log.warn('session check error:', e);
      }
    })();
  };
  checkSession();
  setInterval(checkSession, 30 * 60 * 1000);

  log.info('IPC handlers registered');
}

/**
 * WatchSession を確立する。ログイン切れが疑われる失敗時は自動再ログインを試み、
 * 成功したら watchInfo を取り直して1回だけリトライする。
 * (数日放置後の起動直後など、セッション定期チェックが間に合わないケースの保険)
 */
async function ensureStreamSession(
  videoId: string,
  watchInfo: WatchPageInfo | undefined,
  audioOnly: boolean | undefined,
  videoQualityId: string | undefined
): Promise<{ contentUrl: string; isDMS: boolean }> {
  const info = watchInfo ?? (await WatchInfoHandler.fetchWatchInfo(videoId));
  try {
    return await new WatchSession(info).ensure(audioOnly, videoQualityId);
  } catch (e) {
    const stillLoggedIn = await AuthManager.checkLoggedIn();
    if (stillLoggedIn) throw e;

    log.warn('stream session failed, session may have expired. trying auto relogin:', videoId, e);
    const relogin = await AuthManager.autoRelogin();
    if (!relogin.ok) throw e;

    log.info('auto relogin succeeded, retrying stream session:', videoId);
    const freshInfo = await WatchInfoHandler.fetchWatchInfo(videoId);
    return await new WatchSession(freshInfo).ensure(audioOnly, videoQualityId);
  }
}

function getLanIp(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254.')
      ) {
        return net.address;
      }
    }
  }
  return undefined;
}
