import { isCommentOnlyUri } from '@shared/utils/commentOnly';
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import type { Session } from 'electron';
import { IpcChannel } from '@shared/types';
import type { WatchPageInfo } from '@shared/types';
import { NICO_COOKIE_DOMAIN, NicoApi } from '@shared/constants';
import { getConfigStore } from '../../config/ConfigStore';
import { AuthManager, WatchInfoHandler } from '../../nicovideo';
import { WatchSession } from '../../nicovideo/video/WatchSession';
import { YtDlpStreamer } from '../../nicovideo/video/YtDlpStreamer';
import { LocalTranscodeCache } from '../../nicovideo/video/LocalTranscodeCache';
import {
  PlayerManager,
  type OpenPlayerParams
} from '../../player/PlayerManager';
import { allowUserOpenedFile, buildLocalVideoUrl } from '../../player/LocalVideoProtocol';
import { updateSessionHideHistory } from '../../player/HlsSessionInterceptor';
import { buildHlsProxyBase, buildLocalMediaUrl } from '../../player/StreamServer';
import { encodeProxyUrl } from '../../player/HlsProxy';
import { isLiveProgramId } from '@shared/utils/liveId';
import { watchUrl } from '@shared/utils/nicoUrl';
import { isExternalPlayerEnabled, launchExternalPlayer } from '../../player/ExternalPlayer';
import { createLogger } from '../../util/Logger';
import type { IpcHandlerContext } from './context';

const log = createLogger('IPC');

/**
 * 動画の視聴情報・再生・ストリーム (VIDEO_*)・ローカル ThumbInfo 読み込み・ストリームキャッシュ (CACHE_*)。
 * openPlayer は nndd-re-cmd:// 等 IPC 以外の経路からも呼ぶため返す。
 */
export function registerVideoHandlers(ctx: IpcHandlerContext): {
  openPlayer: (params: OpenPlayerParams) => Promise<void>;
} {
  const { library } = ctx;

  // VIDEO_OPEN_PLAYER 時点でプリフェッチした WatchInfo を一時保持するキャッシュ
  const watchInfoPrefetchCache = new Map<string, Promise<WatchPageInfo>>();

  // --- 動画 ---
  ipcMain.handle(IpcChannel.VIDEO_GET_WATCH_INFO, async (_e, videoId: string, forceAllowHistory?: boolean) => {
    // forceAllowHistory再試行時は、hideWatchHistory設定下で取得済み(失敗済み)の
    // プリフェッチキャッシュを使い回さず、履歴を残して取得し直す。
    if (!forceAllowHistory) {
      const prefetched = watchInfoPrefetchCache.get(videoId);
      if (prefetched) {
        watchInfoPrefetchCache.delete(videoId);
        return prefetched;
      }
    }
    return WatchInfoHandler.fetchWatchInfo(videoId, forceAllowHistory);
  });

  /**
   * 外部プレイヤーに渡す先を決めて起動する。
   * ローカルのファイル (ライブラリ優先) → LANのストリームURL → ニコニコの視聴ページURL の順。
   * 連続再生 (folderPlaylist) は選択した動画以降のファイルをまとめて渡す。
   */
  function openInExternalPlayer(params: OpenPlayerParams): void {
    const MAX_QUEUE = 100;
    let localPath = params.localPath;
    if (!localPath && !params.streamUrl && params.videoId) {
      const video = library.videoDao.getByKey(params.videoId);
      if (video && !isCommentOnlyUri(video.uri) && fs.existsSync(video.uri)) localPath = video.uri;
    }
    if (localPath) {
      const list = params.folderPlaylist ?? [];
      const idx = list.indexOf(localPath);
      launchExternalPlayer(idx >= 0 ? list.slice(idx, idx + MAX_QUEUE) : [localPath]);
    } else if (params.streamUrl) {
      if (/^https?:\/\//i.test(params.streamUrl)) launchExternalPlayer([params.streamUrl]);
    } else if (params.videoId) {
      launchExternalPlayer([watchUrl(params.videoId)]);
    }
  }

  async function openPlayer(rawParams: OpenPlayerParams): Promise<void> {
    // 「コメントのみ」登録の uri (コメントXML) は再生できないので、ストリーミング再生に回す
    const params = rawParams.localPath && isCommentOnlyUri(rawParams.localPath)
      ? { ...rawParams, localPath: undefined, localFiles: undefined, folderPlaylist: undefined }
      : rawParams;
    // 外部プレイヤー設定 (保存していない生放送の番組は専用ウィンドウで扱うので対象外)
    if (isExternalPlayerEnabled() && !(params.videoId && isLiveProgramId(params.videoId) && !params.localPath)) {
      openInExternalPlayer(params);
      return;
    }
    // streamUrl 指定 → LANライブラリのHTTPストリームをそのまま再生 (videoId不明のためレジューム対象外)
    if (params.streamUrl) {
      PlayerManager.get().open(params);
      return;
    }

    const resumePlaybackEnabled = getConfigStore().get('player').resumePlayback;
    const resume = resumePlaybackEnabled && params.videoId ? library.resumeDao.get(params.videoId) : null;
    const resumeSec = resume && resume.positionSec > 3 ? resume.positionSec : undefined;

    // videoId のみ指定 → ライブラリに DL 済みファイルがあればローカル再生を優先
    if (params.videoId && !params.localPath) {
      const video = library.videoDao.getByKey(params.videoId);
      if (video) {
        const fsmod = await import('node:fs');
        if (fsmod.existsSync(video.uri)) {
          log.verbose('VIDEO_OPEN_PLAYER: found in library, using local file', video.uri);
          PlayerManager.get().open({
            // 付帯ファイル (コメントXML等) は元ファイルの隣にあるため、
            // トランスコード後のキャッシュパスではなく元パスから解決する。
            localFiles: PlayerManager.get().resolveLocalFiles(video.uri),
            localPath: await ensurePlayableLocalPath(video.uri),
            videoId: params.videoId,
            searchPlaylist: params.searchPlaylist,
            autoNext: params.autoNext,
            audioOnly: params.audioOnly,
            resumeSec,
          });
          return;
        }
        // DL済み扱いなのに実ファイルが無い = ライブラリとディスクの不整合
        log.warn('VIDEO_OPEN_PLAYER: DB上のuriにファイルなし → ストリーミングへ', {
          videoId: params.videoId,
          uri: video.uri,
        });
      } else {
        // 未DLの動画では通常発生するため verbose
        log.verbose('VIDEO_OPEN_PLAYER: DBにレコードなし → ストリーミングへ', params.videoId);
      }
    }
    // BrowserWindow生成と並列でWatchInfo取得を開始（レンダラー準備完了前に先行）
    // 保存した生放送 (lv) は動画APIに存在せず 400 になるので先読みしない
    if (params.videoId && !isLiveProgramId(params.videoId)) {
      watchInfoPrefetchCache.set(
        params.videoId,
        WatchInfoHandler.fetchWatchInfo(params.videoId)
      );
    }
    const resolvedLocalFiles = params.localPath && !params.localFiles
      ? PlayerManager.get().resolveLocalFiles(params.localPath)
      : params.localFiles;
    const resolvedLocalPath = params.localPath
      ? await ensurePlayableLocalPath(params.localPath)
      : params.localPath;
    PlayerManager.get().open({
      ...params,
      localFiles: resolvedLocalFiles,
      localPath: resolvedLocalPath,
      resumeSec
    });
  }

  // 許可ルート外のファイルでも、ユーザーが明示的に指定した動画・音声ファイル1つだけ再生できるようにする
  ipcMain.handle(IpcChannel.VIDEO_OPEN_FILE, async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
      throw new Error('ファイルが見つかりません');
    }
    if (!allowUserOpenedFile(filePath)) {
      throw new Error('動画・音声ファイルではありません');
    }
    await openPlayer({ localPath: path.resolve(filePath) });
    return true;
  });

  ipcMain.handle(
    IpcChannel.VIDEO_OPEN_PLAYER,
    async (_e, params: OpenPlayerParams) => {
      await openPlayer(params);
      return true;
    }
  );

  // ローカル動画ファイル用 URL を生成。
  // シークが壊れる protocol.handle を避け、ループバック HTTP 配信を優先する。
  // サーバー未起動などで失敗した場合のみカスタムプロトコルへフォールバック。
  ipcMain.handle(IpcChannel.VIDEO_BUILD_LOCAL_URL, (_e, absolutePath: string) => {
    try {
      return buildLocalMediaUrl(absolutePath);
    } catch (e) {
      log.warn('buildLocalMediaUrl 失敗 → custom protocol へフォールバック:', e);
      return buildLocalVideoUrl(absolutePath);
    }
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
      let session: { contentUrl: string; isDMS: boolean; domandBidCookie: string | null };
      try {
        session = await ensureStreamSession(videoId, watchInfo, audioOnly, videoQualityId);
      } catch (e) {
        return { contentUrl: null, isDMS: false, error: e instanceof Error ? e.message : String(e) };
      }
      // 履歴非表示中に「履歴を残して再生する」を選んだ場合、watchInfoは通常ログイン扱い
      // (guestFetched=false) で取得されている。ウィンドウ自体はguest partitionのままなので、
      // HlsSessionInterceptorに実効状態を伝えてCookie扱いを切り替える (ウィンドウ再生成不要)。
      if (watchInfo && !watchInfo.guestFetched) {
        updateSessionHideHistory(_e.sender.session, false);
      }
      if (session.domandBidCookie) {
        await injectDomandBidCookie(_e.sender.session, session.domandBidCookie);
      }
      log.verbose('native: direct stream', videoId, audioOnly ? '(audioOnly)' : '', '→', session.contentUrl.slice(0, 80));
      return { contentUrl: session.contentUrl, isDMS: session.isDMS, isHls: true };
    }

    // --- hls モード: HLS プロキシで即時再生 (yt-dlp ベース) ---
    if (mode === 'hls') {
      let session: { contentUrl: string; isDMS: boolean; domandBidCookie: string | null };
      try {
        session = await ensureStreamSession(videoId, watchInfo, audioOnly, videoQualityId);
      } catch (e) {
        return { contentUrl: null, isDMS: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (watchInfo && !watchInfo.guestFetched) {
        updateSessionHideHistory(_e.sender.session, false);
      }
      if (session.domandBidCookie) {
        await injectDomandBidCookie(_e.sender.session, session.domandBidCookie);
      }
      const proxyBase = buildHlsProxyBase(videoId);
      const proxyMasterUrl = encodeProxyUrl(session.contentUrl, 'm3u8', proxyBase);
      log.verbose('hls: proxy start', videoId, audioOnly ? '(audioOnly)' : '', '→', proxyMasterUrl.slice(0, 80));
      return { contentUrl: proxyMasterUrl, isDMS: session.isDMS, isHls: true };
    }

    return { contentUrl: null, isDMS: false, error: 'unsupported streaming mode' };
  });

  // サムネイルホバープレビュー用。hideWatchHistory設定に関わらず常にゲスト扱いで
  // 取得することで、プレビュー再生がニコニコ側の視聴履歴に残らないようにする。
  ipcMain.handle(IpcChannel.VIDEO_GET_PREVIEW_STREAM_URL, async (_e, videoId: string) => {
    const mode = getConfigStore().get('player').streamingMode ?? 'native';
    if (mode === 'niconico') {
      return { contentUrl: null, error: 'niconicoモードではプレビュー非対応です' };
    }
    const cachedPath = YtDlpStreamer.getCachedPath(videoId);
    if (cachedPath) {
      return { contentUrl: buildLocalVideoUrl(cachedPath), isHls: false };
    }
    try {
      const watchInfo = await WatchInfoHandler.fetchWatchInfo(videoId, false, true, true);
      const session = await ensureStreamSession(videoId, watchInfo, false, undefined);
      if (session.domandBidCookie) {
        await injectDomandBidCookie(_e.sender.session, session.domandBidCookie);
      }
      return { contentUrl: session.contentUrl, isHls: true };
    } catch (e) {
      return { contentUrl: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // --- ローカル ThumbInfo XML 読み込み (旧 info.txt にも後方互換フォールバック) ---
  ipcMain.handle(IpcChannel.THUMB_INFO_XML_READ, async (_e, filePath: string) => {
    const { ThumbInfoXmlReader } = await import('../../nicovideo/video/ThumbInfoXmlReader');
    const parsed = ThumbInfoXmlReader.parseFile(filePath);
    if (parsed) return ThumbInfoXmlReader.toWatchPageInfo(parsed);
    // 後方互換: [info].txt
    const legacyPath = filePath.replace('[ThumbInfo].xml', '[info].txt');
    const { InfoTxtReader } = await import('../../nicovideo/video/InfoTxtReader');
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

  return { openPlayer };
}

/**
 * .flv/.swf 拡張子だが実体がMP4 (本家NNDD時代の遺物) の場合は、正しい拡張子で
 * リンクしたキャッシュパスを返す。実体不明/非対応コーデック等で再生できない場合は
 * 元パスのまま返す (再生自体は従来通り試みる)。
 */
async function ensurePlayableLocalPath(localPath: string): Promise<string> {
  const playable = await LocalTranscodeCache.ensurePlayable(localPath);
  if (!playable) {
    log.warn('ensurePlayableLocalPath: transcode failed, fallback to original', localPath);
    return localPath;
  }
  return playable;
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
): Promise<{ contentUrl: string; isDMS: boolean; domandBidCookie: string | null }> {
  const info = watchInfo ?? (await WatchInfoHandler.fetchWatchInfo(videoId));
  try {
    return await new WatchSession(info).ensure(audioOnly, videoQualityId);
  } catch (e) {
    const stillLoggedIn = await AuthManager.checkLoggedIn();
    const hideHistory = getConfigStore().get('hideWatchHistory') ?? false;
    log.info(
      `[DEBUG-HB] ensureStreamSession failed: stillLoggedIn=${stillLoggedIn} hideHistory=${hideHistory} guestFetched=${info.guestFetched} errMsg=${e instanceof Error ? e.message : String(e)}`
    );
    if (stillLoggedIn) {
      // hideWatchHistory設定でゲスト扱い取得された動画 (年齢制限/センシティブ等) は
      // isDownloadable=false 等でここに失敗する。履歴を残せば再生できる可能性がある旨を
      // マーカー付きで呼び出し元 (renderer) に伝える。
      if (hideHistory && info.guestFetched) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`HISTORY_BLOCKED: ${msg}`);
      }
      throw e;
    }

    log.warn('stream session failed, session may have expired. trying auto relogin:', videoId, e);
    const relogin = await AuthManager.autoRelogin();
    if (!relogin.ok) throw e;

    log.info('auto relogin succeeded, retrying stream session:', videoId);
    const freshInfo = await WatchInfoHandler.fetchWatchInfo(videoId);
    return await new WatchSession(freshInfo).ensure(audioOnly, videoQualityId);
  }
}

/**
 * ゲスト取得 (履歴を残さない設定ON) 時、access-rights API が発行する
 * `domand_bid` Cookie を Player ウィンドウの session に注入する。
 * この Cookie が無いと CDN (delivery.domand.nicovideo.jp) への variant m3u8
 * リクエストが署名付きURLであっても HTTP 403 (CloudFrontレベルで拒否) になる。
 */
async function injectDomandBidCookie(ses: Session, cookieStr: string): Promise<void> {
  const idx = cookieStr.indexOf('=');
  if (idx < 0) return;
  const name = cookieStr.slice(0, idx);
  const value = cookieStr.slice(idx + 1);
  try {
    await ses.cookies.set({
      url: NicoApi.COOKIE_URL,
      name,
      value,
      domain: NICO_COOKIE_DOMAIN,
      path: '/',
      secure: true,
      httpOnly: true
    });
  } catch (e) {
    log.warn('domand_bid cookie injection failed:', e);
  }
}
