import type { WatchPageInfo } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { NicoApiError } from '../NicoHttp';
import { WatchPageParser } from './WatchPageParser';
import { ImageCache } from '../../util/ImageCache';
import { createLogger } from '../../util/Logger';
import path from 'node:path';

const log = createLogger('WatchInfoHandler');

const TRACK_ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 動画IDからウォッチ情報を取得する高レベルAPI。
 * 元: Niconicome の WatchPageInfomationHandler.cs
 *
 * 優先: /api/watch/v3 (JSON API) → フォールバック: HTML スクレイピング
 */
export class WatchInfoHandler {
  static async fetchWatchInfo(rawId: string, forceAllowHistory = false): Promise<WatchPageInfo> {
    const info = await WatchInfoHandler.fetchWatchInfoInner(rawId, forceAllowHistory);
    return WatchInfoHandler.applyImageCache(info);
  }

  /** 画像キャッシュを適用しない生 WatchPageInfo を取得する (DL フロー向け) */
  static async fetchWatchInfoRaw(rawId: string, forceAllowHistory = false): Promise<WatchPageInfo> {
    return WatchInfoHandler.fetchWatchInfoInner(rawId, forceAllowHistory);
  }

  /** 画像キャッシュ適用前の生 WatchPageInfo を取得する内部実装 */
  private static async fetchWatchInfoInner(rawId: string, forceAllowHistory = false): Promise<WatchPageInfo> {
    const videoId = WatchInfoHandler.extractVideoId(rawId);
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    // forceAllowHistory: 「履歴非表示中のため再生失敗」ダイアログでユーザーが
    // 履歴を残しての再取得を選んだ場合、hideWatchHistory設定を無視する。
    const hideHistory = !forceAllowHistory && (configStore.get('hideWatchHistory') ?? false);
    // 履歴非表示ON時は最初からゲスト扱い (v3_guest + Cookie無し) で取得する。
    // v3 は Cookie 認証必須のため、Cookie無しで叩いても失敗するだけ。
    const effectiveLoggedIn = loggedIn && !hideHistory;
    let apiError: NicoApiError | undefined;
    try {
      const info = await WatchInfoHandler.fetchViaJsonApi(videoId, effectiveLoggedIn, hideHistory);
      // v3 APIが series:null を返した場合は HTML から補完を試みる
      if (!info.series) {
        const series = await WatchInfoHandler.fetchSeriesFromHtml(videoId, hideHistory);
        if (series) {
          log.debug('series補完 (HTML): videoId=%s seriesId=%s', videoId, series.id);
          return { ...info, series };
        }
      }
      return info;
    } catch (e) {
      if (e instanceof NicoApiError) apiError = e;
      // ログイン中で v3 が失敗した場合は v3_guest にもフォールバック
      if (effectiveLoggedIn) {
        try {
          return await WatchInfoHandler.fetchViaJsonApi(videoId, false, hideHistory);
        } catch (e2) {
          // ゲストでも同じ理由で失敗 → こちらのerrorCodeの方が「本当にダメ」な判定に近い
          if (e2 instanceof NicoApiError) apiError = e2;
          log.warn('watch v3_guest fallback also failed:', e2);
        }
      }
      log.warn('watch v3 JSON API failed, falling back to HTML scrape:', e);
      try {
        const htmlInfo = await WatchInfoHandler.fetchViaHtml(videoId, hideHistory);
        log.info(
          `[DEBUG-HB] HTML scrape OK: isDownloadable=${htmlInfo.isDownloadable} guestFetched=${htmlInfo.guestFetched} accessRightKey=${!!htmlInfo.domandAccessRightKey} videos=${htmlInfo.domandVideos?.length ?? -1} dmc=${!!htmlInfo.dmcSessionRequestJson}`
        );
        return htmlInfo;
      } catch (e3) {
        // HTML watch page の 404 は「その動画IDが存在しない」ことを示す最も確実な情報。
        // 削除済みは履歴を残しても絶対に見られないため、hideHistoryチェックより先に
        // 判定し、HISTORY_BLOCKED (履歴を残せば見れるかも、の確認フロー) には回さない。
        if (e3 instanceof NicoApiError && (e3.httpStatus === 404 || /NOT_FOUND/.test((e3.errorCode ?? '').toUpperCase()))) {
          throw new Error('VIDEO_DELETED: 動画が削除されているか、存在しません');
        }
        // hideHistory由来のゲスト取得で完全に失敗した場合、年齢制限/限定公開動画の
        // 可能性がある旨をマーカー付きで呼び出し元 (renderer) に伝える。
        if (hideHistory) {
          const msg = e3 instanceof Error ? e3.message : String(e3);
          throw new Error(`HISTORY_BLOCKED: ${msg}`);
        }
        // (JSON API は削除済み/非公開いずれも 400 errorCode=FORBIDDEN 固定で区別できない実測結果あり)
        if (e3 instanceof NicoApiError) {
          throw WatchInfoHandler.classifyApiError(e3);
        }
        if (apiError) {
          throw WatchInfoHandler.classifyApiError(apiError);
        }
        throw e3;
      }
    }
  }

  /**
   * watch v3/v3_guest/HTML の失敗レスポンスから「削除済み/視聴制限あり」を推定し、
   * 機械可読prefix付きErrorに変換する。
   * 実測結果: JSON API (v3/v3_guest) は非公開・削除済みいずれも 400 errorCode=FORBIDDEN 固定で
   * ログイン要否等の詳細区別はできない。HTML watch page の 404 だけが
   * 「動画IDが存在しない」ことを示す確実な情報のため、それ以外は
   * 「非公開・限定公開・ログイン必要等のいずれか」とまとめて扱う。
   */
  private static classifyApiError(err: NicoApiError): Error {
    const code = (err.errorCode ?? '').toUpperCase();
    const status = err.httpStatus;

    if (status === 404 || /NOT_FOUND/.test(code)) {
      return new Error('VIDEO_DELETED: 動画が削除されているか、存在しません');
    }
    if (/MAINTENANCE/.test(code)) {
      return new Error('VIDEO_MAINTENANCE: ニコニコ動画がメンテナンス中の可能性があります');
    }
    if (status === 400 || status === 401 || status === 403) {
      return new Error(
        `VIDEO_RESTRICTED: 非公開・限定公開・ログインが必要な動画のいずれかの可能性があります (errorCode=${err.errorCode ?? '不明'})`
      );
    }
    return new Error(
      `VIDEO_UNKNOWN_ERROR: 動画情報取得失敗 (status=${status}${err.errorCode ? `, errorCode=${err.errorCode}` : ''})`
    );
  }

  /**
   * HTMLウォッチページからシリーズ情報だけを抽出する。
   * v3 API が series:null を返した場合のフォールバック。
   * 1) HTML埋め込みJSONからシリーズを取得
   * 2) 埋め込みJSONがダメなら href="/series/数字" を正規表現で取得し、
   *    nvapi でタイトルを補完する
   */
  private static async fetchSeriesFromHtml(
    videoId: string,
    noCookie = false
  ): Promise<{ id: string; title: string } | null> {
    try {
      const ctx = NicoContext.get();
      const url = `${NicoApi.WATCH_PAGE}${videoId}`;
      log.debug('fetchSeriesFromHtml: fetching HTML for series:', url);
      const html = await ctx.http.getText(url, { noCookie, noCookieReceive: noCookie });
      const series = WatchPageParser.parseSeriesFromHtml(html);
      if (!series) return null;

      // タイトルが空 (href パターンから ID のみ取得した場合) は nvapi で補完
      if (!series.title) {
        log.debug('fetchSeriesFromHtml: title missing, fetching from nvapi. seriesId=%s', series.id);
        const title = await WatchInfoHandler.fetchSeriesTitleFromApi(series.id, noCookie);
        return { id: series.id, title: title ?? `シリーズ ${series.id}` };
      }
      return series;
    } catch (e) {
      log.warn('fetchSeriesFromHtml failed:', e);
      return null;
    }
  }

  /**
   * nvapi v2/series/{id} からシリーズタイトルだけを取得する。
   * 認証済み HTTP クライアント経由で呼ぶ。
   * ※ SERIES_API は v1 だが series 詳細は v2 エンドポイントで取得する。
   */
  private static async fetchSeriesTitleFromApi(
    seriesId: string,
    noCookie = false
  ): Promise<string | null> {
    try {
      const ctx = NicoContext.get();
      // v2/series/{id} は detail.title を含む (registerIpc.ts と同じエンドポイント)
      const url = `https://nvapi.nicovideo.jp/v2/series/${encodeURIComponent(seriesId)}?pageSize=1&page=1`;
      log.debug('fetchSeriesTitleFromApi:', url);
      const res = await ctx.http.getJson<{ data?: { detail?: { title?: string } } }>(url, {
        noCookie,
        noCookieReceive: noCookie
      });
      const title = res?.data?.detail?.title ?? null;
      log.debug('fetchSeriesTitleFromApi: title=%s', title);
      return title ?? null;
    } catch (e) {
      log.warn('fetchSeriesTitleFromApi failed:', e);
      return null;
    }
  }

  /**
   * WatchPageInfo 内の画像 URL (サムネイル・オーナーアイコン) を
   * ImageCache 経由でローカルキャッシュし、nndd-re-local:// URL に差し替えて返す。
   * ImageCache が無効な場合は info をそのまま返す。
   */
  private static async applyImageCache(info: WatchPageInfo): Promise<WatchPageInfo> {
    if (!ImageCache.isEnabled()) return info;
    const ctx = NicoContext.get();
    const http = ctx.http;

    const [thumbUrl, thumbLargeUrl, ownerIconUrl] = await Promise.all([
      info.thumbnail.url
        ? ImageCache.getOrFetch(info.thumbnail.url, http)
        : Promise.resolve(''),
      info.thumbnail.largeUrl
        ? ImageCache.getOrFetch(info.thumbnail.largeUrl, http)
        : Promise.resolve(''),
      info.owner?.iconUrl
        ? ImageCache.getOrFetch(info.owner.iconUrl, http)
        : Promise.resolve('')
    ]);

    return {
      ...info,
      thumbnail: {
        url: thumbUrl || info.thumbnail.url,
        largeUrl: thumbLargeUrl || info.thumbnail.largeUrl,
        remoteUrl: info.thumbnail.remoteUrl
      },
      owner: info.owner
        ? { ...info.owner, iconUrl: ownerIconUrl || info.owner.iconUrl }
        : null
    };
  }

  /** watch v3 / v3_guest JSON API を直接叩く (nvComment 構造が確実に取れる) */
  private static async fetchViaJsonApi(
    videoId: string,
    loggedIn: boolean,
    noCookie = false
  ): Promise<WatchPageInfo> {
    const ctx = NicoContext.get();
    const actionTrackId = WatchInfoHandler.generateActionTrackId();
    // ログイン: /api/watch/v3 (user-session 必須)
    // 未ログイン: /api/watch/v3_guest
    const endpoint = loggedIn ? 'v3' : 'v3_guest';
    const url = `https://www.nicovideo.jp/api/watch/${endpoint}/${encodeURIComponent(videoId)}?actionTrackId=${actionTrackId}`;
    log.debug('fetching watch JSON API:', url);
    
    // debugDumpPath の設定 (設定画面から有効化)
    let debugDumpPath: string | undefined;
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    const developerEnabled = configStore.get('developer.enabled') ?? false;
    const developerTargets = configStore.get('developer.apiDumpTargets') ?? ['watch'];
    
    if (developerEnabled && developerTargets.includes('watch')) {
      debugDumpPath = configStore.get('developer.apiDumpPath') || path.join(process.cwd(), 'apitest');
      log.info(`API dump enabled: ${debugDumpPath}`);
    }
    
    const json = await ctx.http.getJson<{ data: unknown }>(url, {
      headers: {
        'X-Frontend-Id': '6',
        'X-Frontend-Version': '0',
        'X-Niconico-Language': 'ja-jp',
        'X-Request-With': 'https://www.nicovideo.jp'
      },
      noCookie,
      noCookieReceive: noCookie,
      debugDumpPath,
      debugLabel: `watch-${endpoint}`
    });
    if (!json?.data) throw new Error(`watch ${endpoint} API: data field missing`);
    const parsed = WatchPageParser.parseApiData(json.data, videoId, actionTrackId);
    // v3_guest エンドポイント or Cookie無しで叩いた場合、accessRightKey はゲスト用JWTになる。
    // 後続の DMS access-rights POST でも Cookie無し送信を強制するためにフラグを立てる。
    return { ...parsed, guestFetched: !loggedIn || noCookie };
  }

  /** HTMLスクレイピング (フォールバック) */
  private static async fetchViaHtml(videoId: string, noCookie = false): Promise<WatchPageInfo> {
    const ctx = NicoContext.get();
    const url = `${NicoApi.WATCH_PAGE}${videoId}`;
    log.debug('fetching watch page (HTML):', url);
    const html = await ctx.http.getText(url, { noCookie, noCookieReceive: noCookie });
    const parsed = WatchPageParser.parse(html, videoId);
    return { ...parsed, guestFetched: noCookie };
  }

  private static extractVideoId(input: string): string {
    try {
      const u = new URL(input);
      const m = u.pathname.match(/\/watch\/([^/?#]+)/);
      if (m) return m[1];
    } catch {
      // not a URL
    }
    return input.trim();
  }

  private static generateActionTrackId(): string {
    const rand10 = Array.from({ length: 10 }, () =>
      TRACK_ID_CHARS[Math.floor(Math.random() * TRACK_ID_CHARS.length)]
    ).join('');
    return `${rand10}_${Date.now()}`;
  }
}
