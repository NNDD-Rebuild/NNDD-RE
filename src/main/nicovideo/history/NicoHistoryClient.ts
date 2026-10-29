import type { NicoWatchHistoryItem } from '@shared/types';
import { NicoEndpoint } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { AccountManager } from '../auth/AccountManager';
import { createLogger } from '../../util/Logger';
import { nicoHistoryKey, type NicoWatchHistoryDao } from '../../db/dao/NicoWatchHistoryDao';
import type { NicoNvapiWatchHistoryResponse } from '../apiTypes';

const log = createLogger('NicoHistoryClient');

/** 起動時の差分取得で辿るページ数の上限 (limit=100なら最大2000件) */
const MAX_DIFF_PAGES = 20;

/**
 * ニコニコ動画本家 (公式サイト) の視聴履歴 API クライアント。
 * GET https://nvapi.nicovideo.jp/v2/users/me/watch/history?selectContentType=long&limit=&cursor=
 * (非公式、要ログインCookie。ページネーションは page 番号ではなく nextCursor を引き回すカーソル方式)
 */
export class NicoHistoryClient {
  /**
   * 本家の視聴履歴から1件削除する。
   * DELETE /v2/users/me/watch/history?target={videoId} (ブラウザ版の「視聴履歴から削除」と同じ。失敗時は例外)
   */
  static async removeItem(videoId: string): Promise<void> {
    await NicoContext.get().http.send('DELETE', NicoEndpoint.watchHistoryDelete(videoId));
  }

  static async fetchPage(
    cursor?: string,
    limit = 100
  ): Promise<{ items: NicoWatchHistoryItem[]; nextCursor?: string }> {
    const ctx = NicoContext.get();
    const params = new URLSearchParams({ selectContentType: 'long', limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const url = NicoEndpoint.watchHistory(params);
    const res = await ctx.http.getJson<NicoNvapiWatchHistoryResponse>(url);
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
   * 差分取得。視聴履歴は新しい順に返る。同じ動画を見直すと先頭に移動するため、
   * 既知の項目に1件当たっただけで打ち切ると、その下にある未取得の新しい履歴を取りこぼす。
   * そこで「1ページ全部が既知」になったページで打ち切る (そのページまでの項目は更新用に返す)。
   * 履歴は (videoId, 視聴日時) 単位で、同じ動画を複数回見た分は別項目。
   * 初回 (knownVideoIdsが空) は MAX_DIFF_PAGES まで取得し実質フル取得になる。
   */
  static async fetchDiff(knownKeys: Set<string>, limit = 100): Promise<NicoWatchHistoryItem[]> {
    const result = new Map<string, NicoWatchHistoryItem>();
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_DIFF_PAGES; page++) {
      const { items, nextCursor } = await this.fetchPage(cursor, limit);
      if (items.length === 0) break;
      let allKnown = true;
      for (const item of items) {
        const key = nicoHistoryKey(item.videoId, item.watchedAt);
        if (!knownKeys.has(key)) allKnown = false;
        result.set(key, item);
      }
      if (allKnown || !nextCursor) break;
      cursor = nextCursor;
    }
    return [...result.values()];
  }

  /**
   * 本家の履歴を全件読み直してローカルと一致させる (更新ボタン用)。
   * 本家側 (ブラウザ等) で消された項目もローカルから消すが、保存期間切れで消えた古い履歴は残す。
   * MAX_DIFF_PAGES で打ち切った場合は全件を見られていないので削除はせず追加・更新だけ行う。失敗しても例外にはしない。
   */
  static async syncFull(dao: NicoWatchHistoryDao, limit = 100): Promise<void> {
    try {
      const ctx = NicoContext.get();
      if (!(await ctx.isLoggedIn())) return;
      // 取得中にアカウントが切り替わったら、前のアカウントの履歴として保存しない
      const account = AccountManager.key;
      const all = new Map<string, NicoWatchHistoryItem>();
      let cursor: string | undefined;
      let complete = false;
      for (let page = 1; page <= MAX_DIFF_PAGES; page++) {
        const { items, nextCursor } = await this.fetchPage(cursor, limit);
        for (const it of items) all.set(nicoHistoryKey(it.videoId, it.watchedAt), it);
        if (items.length === 0 || !nextCursor) {
          complete = true;
          break;
        }
        cursor = nextCursor;
      }
      if (AccountManager.key !== account) return;
      if (all.size > 0) dao.upsertBatch(account, [...all.values()]);
      // 保存期間切れで本家から消えた履歴はローカルに残したい。本家に残っている最古の視聴日時より新しい分だけを
      // 「本家で削除された」と見なす (最古が分からない = 視聴日時付きの項目が無いときは何も消さない)
      let oldestSec = Infinity;
      for (const it of all.values()) if (it.watchedAt) oldestSec = Math.min(oldestSec, it.watchedAt.getTime() / 1000);
      if (complete && Number.isFinite(oldestSec)) {
        const removed = dao.removeNotIn(account, new Set(all.keys()), oldestSec);
        if (removed > 0) log.info(`nico watch history: removed ${removed} items deleted on the server`);
      }
    } catch (e) {
      log.warn('nico watch history full sync failed:', e);
    }
  }

  /** 起動時フック: ログイン済みなら差分取得してDBへ反映。失敗しても起動処理は継続させる */
  static async syncOnStartup(dao: NicoWatchHistoryDao): Promise<void> {
    try {
      const ctx = NicoContext.get();
      if (!(await ctx.isLoggedIn())) return;
      const account = AccountManager.key;
      const items = await this.fetchDiff(dao.listKeys(account));
      if (AccountManager.key !== account) return;
      if (items.length > 0) {
        dao.upsertBatch(account, items);
        log.info(`nico watch history synced: ${items.length} new items`);
      }
    } catch (e) {
      log.warn('nico watch history sync failed:', e);
    }
  }
}
