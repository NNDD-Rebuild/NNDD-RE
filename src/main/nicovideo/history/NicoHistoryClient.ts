import type { NicoWatchHistoryItem } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import type { NicoWatchHistoryDao } from '../../db/dao/NicoWatchHistoryDao';

const log = createLogger('NicoHistoryClient');

/** 起動時の差分取得で辿るページ数の上限 (limit=100なら最大2000件) */
const MAX_DIFF_PAGES = 20;

interface NvApiWatchHistoryResponse {
  meta?: { status?: number; errorCode?: string };
  data?: {
    items?: Array<{
      viewedAt?: string;
      video: {
        id: string;
        title: string;
        thumbnail?: { url?: string };
      };
    }>;
    nextCursor?: string;
  };
}

/**
 * ニコニコ動画本家 (公式サイト) の視聴履歴 API クライアント。
 * GET https://nvapi.nicovideo.jp/v2/users/me/watch/history?selectContentType=long&limit=&cursor=
 * (非公式、要ログインCookie。ページネーションは page 番号ではなく nextCursor を引き回すカーソル方式)
 */
export class NicoHistoryClient {
  static async fetchPage(
    cursor?: string,
    limit = 100
  ): Promise<{ items: NicoWatchHistoryItem[]; nextCursor?: string }> {
    const ctx = NicoContext.get();
    const params = new URLSearchParams({ selectContentType: 'long', limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const url = `https://nvapi.nicovideo.jp/v2/users/me/watch/history?${params.toString()}`;
    const res = await ctx.http.getJson<NvApiWatchHistoryResponse>(url);
    if (res.meta?.status && res.meta.status >= 400) {
      throw new Error(`視聴履歴取得に失敗: status=${res.meta.status} errorCode=${res.meta.errorCode}`);
    }
    const rawItems = res.data?.items ?? [];
    const fetchedAt = new Date();
    const items = rawItems.map((i) => ({
      videoId: i.video.id,
      title: i.video.title,
      thumbnailUrl: i.video.thumbnail?.url ?? '',
      watchedAt: i.viewedAt ? new Date(i.viewedAt) : null,
      fetchedAt
    }));
    return { items, nextCursor: res.data?.nextCursor };
  }

  /**
   * 差分取得。視聴履歴は新しい順に返る前提で、既知videoIdに当たった時点で打ち切る。
   * 初回 (knownVideoIdsが空) は MAX_DIFF_PAGES まで取得し実質フル取得になる。
   */
  static async fetchDiff(knownVideoIds: Set<string>, limit = 100): Promise<NicoWatchHistoryItem[]> {
    const result: NicoWatchHistoryItem[] = [];
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_DIFF_PAGES; page++) {
      const { items, nextCursor } = await this.fetchPage(cursor, limit);
      if (items.length === 0) break;
      let hitKnown = false;
      for (const item of items) {
        if (knownVideoIds.has(item.videoId)) {
          hitKnown = true;
          break;
        }
        result.push(item);
      }
      if (hitKnown || !nextCursor) break;
      cursor = nextCursor;
    }
    return result;
  }

  /** 起動時フック: ログイン済みなら差分取得してDBへ反映。失敗しても起動処理は継続させる */
  static async syncOnStartup(dao: NicoWatchHistoryDao): Promise<void> {
    try {
      const ctx = NicoContext.get();
      if (!(await ctx.isLoggedIn())) return;
      const knownIds = dao.listVideoIds();
      const items = await this.fetchDiff(knownIds);
      if (items.length > 0) {
        dao.upsertBatch(items);
        log.info(`nico watch history synced: ${items.length} new items`);
      }
    } catch (e) {
      log.warn('nico watch history sync failed:', e);
    }
  }
}
