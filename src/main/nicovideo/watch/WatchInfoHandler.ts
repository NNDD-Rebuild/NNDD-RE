import type { WatchPageInfo } from '@shared/types';
import { NicoApi } from '@shared/constants';
import { NicoContext } from '../NicoContext';
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
  static async fetchWatchInfo(rawId: string): Promise<WatchPageInfo> {
    const info = await WatchInfoHandler.fetchWatchInfoInner(rawId);
    return WatchInfoHandler.applyImageCache(info);
  }

  /** 画像キャッシュを適用しない生 WatchPageInfo を取得する (DL フロー向け) */
  static async fetchWatchInfoRaw(rawId: string): Promise<WatchPageInfo> {
    return WatchInfoHandler.fetchWatchInfoInner(rawId);
  }

  /** 画像キャッシュ適用前の生 WatchPageInfo を取得する内部実装 */
  private static async fetchWatchInfoInner(rawId: string): Promise<WatchPageInfo> {
    const videoId = WatchInfoHandler.extractVideoId(rawId);
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    try {
      const info = await WatchInfoHandler.fetchViaJsonApi(videoId, loggedIn);
      // v3 APIが series:null を返した場合は HTML から補完を試みる
      if (!info.series) {
        const series = await WatchInfoHandler.fetchSeriesFromHtml(videoId);
        if (series) {
          log.debug('series補完 (HTML): videoId=%s seriesId=%s', videoId, series.id);
          return { ...info, series };
        }
      }
      return info;
    } catch (e) {
      // ログイン中で v3 が失敗した場合は v3_guest にもフォールバック
      if (loggedIn) {
        try {
          return await WatchInfoHandler.fetchViaJsonApi(videoId, false);
        } catch (e2) {
          log.warn('watch v3_guest fallback also failed:', e2);
        }
      }
      log.warn('watch v3 JSON API failed, falling back to HTML scrape:', e);
      return await WatchInfoHandler.fetchViaHtml(videoId);
    }
  }

  /**
   * HTMLウォッチページからシリーズ情報だけを抽出する。
   * v3 API が series:null を返した場合のフォールバック。
   * 1) HTML埋め込みJSONからシリーズを取得
   * 2) 埋め込みJSONがダメなら href="/series/数字" を正規表現で取得し、
   *    nvapi でタイトルを補完する
   */
  private static async fetchSeriesFromHtml(
    videoId: string
  ): Promise<{ id: string; title: string } | null> {
    try {
      const ctx = NicoContext.get();
      const url = `${NicoApi.WATCH_PAGE}${videoId}`;
      log.debug('fetchSeriesFromHtml: fetching HTML for series:', url);
      const html = await ctx.http.getText(url);
      const series = WatchPageParser.parseSeriesFromHtml(html);
      if (!series) return null;

      // タイトルが空 (href パターンから ID のみ取得した場合) は nvapi で補完
      if (!series.title) {
        log.debug('fetchSeriesFromHtml: title missing, fetching from nvapi. seriesId=%s', series.id);
        const title = await WatchInfoHandler.fetchSeriesTitleFromApi(series.id);
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
  private static async fetchSeriesTitleFromApi(seriesId: string): Promise<string | null> {
    try {
      const ctx = NicoContext.get();
      // v2/series/{id} は detail.title を含む (registerIpc.ts と同じエンドポイント)
      const url = `https://nvapi.nicovideo.jp/v2/series/${encodeURIComponent(seriesId)}?pageSize=1&page=1`;
      log.debug('fetchSeriesTitleFromApi:', url);
      const res = await ctx.http.getJson<{ data?: { detail?: { title?: string } } }>(url);
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
        largeUrl: thumbLargeUrl || info.thumbnail.largeUrl
      },
      owner: info.owner
        ? { ...info.owner, iconUrl: ownerIconUrl || info.owner.iconUrl }
        : null
    };
  }

  /** watch v3 / v3_guest JSON API を直接叩く (nvComment 構造が確実に取れる) */
  private static async fetchViaJsonApi(
    videoId: string,
    loggedIn: boolean
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
      debugDumpPath,
      debugLabel: `watch-${endpoint}`
    });
    if (!json?.data) throw new Error(`watch ${endpoint} API: data field missing`);
    return WatchPageParser.parseApiData(json.data, videoId);
  }

  /** HTMLスクレイピング (フォールバック) */
  private static async fetchViaHtml(videoId: string): Promise<WatchPageInfo> {
    const ctx = NicoContext.get();
    const url = `${NicoApi.WATCH_PAGE}${videoId}`;
    log.debug('fetching watch page (HTML):', url);
    const html = await ctx.http.getText(url);
    return WatchPageParser.parse(html, videoId);
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
