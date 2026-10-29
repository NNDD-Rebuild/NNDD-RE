import type { MyListItem, MyList, UserMylistSummary } from '@shared/types';
import { RssType } from '@shared/types';
import { PLAYLIST_SYNC_MARKER } from '@shared/types/playlist';
import { NicoEndpoint } from '@shared/constants';
import { mylistUrl } from '@shared/utils/nicoUrl';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { ImageCache } from '../../util/ImageCache';
import type { NicoNvapiMylistResponse } from '../apiTypes';

const log = createLogger('MyListClient');

/**
 * マイリスト API クライアント (V2)。
 *
 * 公開マイリスト: GET https://nvapi.nicovideo.jp/v2/mylists/{id}?pageSize=N
 * 自分のマイリスト: GET https://nvapi.nicovideo.jp/v1/users/me/mylists
 *
 * 元: Niconicome の Remote/V2/Mylist/MylistHandler.cs
 */
export class MyListClient {
  static async fetchPublicMylist(
    mylistId: string,
    page = 1,
    pageSize = 100,
    cacheImages = true
  ): Promise<{ items: MyListItem[]; total: number }> {
    // 自分のマイリスト (非公開含む) を取得できる /v1/users/me/mylists/{id} を最初に試す。
    // 401 / 403 / 404 が返ったら公開マイリスト /v2/mylists/{id} にフォールバック。
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const candidates = loggedIn
      ? [
          NicoEndpoint.myMylist(mylistId, pageSize, page),
          NicoEndpoint.publicMylist(mylistId, pageSize, page)
        ]
      : [NicoEndpoint.publicMylist(mylistId, pageSize, page)];

    let res: NicoNvapiMylistResponse | null = null;
    let lastError: unknown = null;
    for (const url of candidates) {
      log.verbose('fetch mylist:', url);
      try {
        res = await ctx.http.getJson<NicoNvapiMylistResponse>(url);
        const status = res.meta?.status;
        if (status && status >= 400) {
          log.warn(`mylist fetch returned status=${status} errorCode=${res.meta?.errorCode}, trying fallback`);
          res = null;
          continue;
        }
        break;
      } catch (e) {
        lastError = e;
        log.warn(`mylist fetch HTTP error for ${url}:`, e);
      }
    }
    if (!res) {
      throw new Error(
        `マイリスト ${mylistId} の取得に失敗: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
    const rawItems = res.data?.mylist?.items ?? res.data?.items ?? [];
    const total = res.data?.mylist?.totalItemCount ?? rawItems.length;
    log.verbose(`mylist ${mylistId} page=${page} items=${rawItems.length} total=${total}`);
    let items = rawItems.map((i) => ({
      videoId: i.video.id,
      title: i.video.title,
      description: i.description ?? '',
      thumbnailUrl: i.video.thumbnail?.url ?? '',
      length: this.toLengthString(i.video.duration),
      pubDate: new Date(i.video.registeredAt),
      viewCount: i.video.count?.view ?? 0,
      commentCount: i.video.count?.comment ?? 0,
      mylistCount: i.video.count?.mylist ?? 0,
      likeCount: i.video.count?.like ?? 0,
      itemId: i.itemId
    }));
    if (cacheImages && ImageCache.isEnabled()) {
      const http = NicoContext.get().http;
      const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    return { items, total };
  }

  /**
   * マイリストID からマイリスト名・説明を取得 (アイテムは取得しない軽量版)。
   */
  static async fetchMylistInfo(
    mylistId: string
  ): Promise<{ name: string; description?: string } | null> {
    const ctx = NicoContext.get();
    const loggedIn = await ctx.isLoggedIn();
    const urls = loggedIn
      ? [
          NicoEndpoint.myMylist(mylistId, 1, 1),
          NicoEndpoint.publicMylist(mylistId, 1, 1)
        ]
      : [NicoEndpoint.publicMylist(mylistId, 1, 1)];

    for (const url of urls) {
      try {
        const res = await ctx.http.getJson<NicoNvapiMylistResponse>(url);
        if (res.meta?.status && res.meta.status >= 400) continue;
        const name = res.data?.mylist?.name;
        if (name) return { name, description: res.data?.mylist?.description };
      } catch {/* try next */}
    }
    return null;
  }

  /**
   * あとで見る (サーバー側) を全件取得する。常にサーバーを正とし、ローカルには保存しない。
   * GET /v1/users/me/watch-later?page=N → data.watchLater.{items, totalCount, hasNext}
   * 項目の削除には動画IDではなく itemId が要るため、各項目に載せて返す。
   */
  static async fetchWatchLater(
    pageSize = 100,
    maxItems = 1000
  ): Promise<{ items: MyListItem[]; total: number }> {
    const http = NicoContext.get().http;
    const raw: NonNullable<NonNullable<NicoNvapiMylistResponse['data']>['watchLater']>['items'] = [];
    let total = 0;
    for (let page = 1; raw.length < maxItems; page++) {
      const res = await http.getJson<NicoNvapiMylistResponse>(
        NicoEndpoint.watchLaterList(pageSize, page)
      );
      const wl = res.data?.watchLater;
      raw.push(...(wl?.items ?? []));
      total = wl?.totalCount ?? raw.length;
      if (!wl?.hasNext || (wl.items ?? []).length === 0) break;
    }
    // 視聴不可になった動画 (video 欠落) は一覧に出せないので除く
    let items: MyListItem[] = raw
      .filter((i) => i.video)
      .map((i) => ({
        videoId: i.video.id,
        title: i.video.title,
        description: i.memo ?? '',
        thumbnailUrl: i.video.thumbnail?.url ?? '',
        length: this.toLengthString(i.video.duration),
        pubDate: new Date(i.video.registeredAt),
        viewCount: i.video.count?.view ?? 0,
        commentCount: i.video.count?.comment ?? 0,
        mylistCount: i.video.count?.mylist ?? 0,
        likeCount: i.video.count?.like ?? 0,
        isChannelVideo: i.video.isChannelVideo ?? false,
        itemId: i.itemId
      }));
    if (ImageCache.isEnabled()) {
      const urls = ImageCache.cacheUrlList(items.map((i) => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    return { items, total };
  }

  /**
   * あとで見るから項目を削除する。itemIds は fetchWatchLater の itemId (動画IDではない)。
   * DELETE /v1/users/me/watch-later?itemIds=a,b
   */
  static async removeWatchLater(itemIds: number[]): Promise<void> {
    if (itemIds.length === 0) return;
    await NicoContext.get().http.send('DELETE', NicoEndpoint.watchLaterDelete(itemIds));
  }

  /**
   * 自分のマイリストのID一覧 (所有確認用)。他人の公開マイリストは含まれない。
   * GET /v1/users/me/mylists/compact
   */
  static async fetchOwnMylistIds(): Promise<Set<string>> {
    const res = await NicoContext.get().http.getJson<{
      data?: { mylists?: Array<{ id: number | string }> };
    }>(NicoEndpoint.myMylistsCompact());
    return new Set((res.data?.mylists ?? []).map((m) => String(m.id)));
  }

  private static ownIdsCache: { at: number; ids: Set<string> } | null = null;
  /** マイリストID → (動画ID → itemId)。1 件削除のたびに全件取得しないための控え */
  private static ownItemIdCache = new Map<string, Map<string, number>>();

  /**
   * 自分のマイリストか。書き込みのたびに確認するが、連続操作で毎回 API を叩かないよう短時間だけ覚える。
   * 他人のマイリストへの書き込みは必ず 403 になるため、先に弾いて分かりやすいエラーにする。
   */
  static async isOwnMylist(mylistId: string): Promise<boolean> {
    const now = Date.now();
    if (!this.ownIdsCache || now - this.ownIdsCache.at > 30_000) {
      this.ownIdsCache = { at: now, ids: await this.fetchOwnMylistIds() };
    }
    return this.ownIdsCache.ids.has(mylistId);
  }

  /** 所有確認のキャッシュを捨てる (マイリストの作成・削除、ログアウト・アカウント切替の後) */
  static clearOwnMylistCache(): void {
    this.ownIdsCache = null;
    this.ownItemIdCache.clear();
  }

  /**
   * 自分のマイリストをニコニコ上から削除する。取り消せない。
   * DELETE /v1/users/me/mylists/{id}
   */
  static async deleteMylist(mylistId: string): Promise<void> {
    await NicoContext.get().http.send('DELETE', NicoEndpoint.myMylistById(mylistId));
    this.clearOwnMylistCache();
  }

  /**
   * 自分のマイリストへ動画を追加する (ボディなし。重複追加などはサーバーがエラーを返す)。
   * POST /v1/users/me/mylists/{id}/items?itemId=動画ID
   */
  static async addItem(mylistId: string, videoId: string): Promise<void> {
    await NicoContext.get().http.send('POST', NicoEndpoint.myMylistAddItem(mylistId, videoId));
  }

  /**
   * 自分のマイリストから項目を削除する。itemIds は fetchPublicMylist の itemId (動画IDではない)。
   * DELETE /v1/users/me/mylists/{id}/items?itemIds=a,b
   */
  static async removeItems(mylistId: string, itemIds: number[]): Promise<void> {
    if (itemIds.length === 0) return;
    await NicoContext.get().http.send('DELETE', NicoEndpoint.myMylistDeleteItems(mylistId, itemIds));
  }

  /**
   * 自分のマイリストを新規作成する。公開すると意図せず見られるため、既定は非公開。
   * POST /v1/users/me/mylists (form) → data.mylistId
   */
  static async createMylist(name: string, isPublic = false, description = ''): Promise<string> {
    const res = await NicoContext.get().http.send<{ data?: { mylistId?: number | string } }>(
      'POST',
      NicoEndpoint.myMylists(),
      {
        form: {
          name,
          description,
          isPublic: isPublic ? 'true' : 'false',
          defaultSortKey: 'addedAt',
          defaultSortOrder: 'desc'
        }
      }
    );
    const id = res?.data?.mylistId;
    if (id === undefined || id === null) throw new Error('マイリストの作成結果からIDを取得できませんでした');
    this.clearOwnMylistCache();
    return String(id);
  }

  /**
   * 自分のマイリストの全項目を取得する (プレイリスト同期用)。
   * 一部しか取れていない状態で「サーバーに無い」と判定すると誤削除につながるため、
   * 上限を超える場合は取得せず例外にする。
   */
  static async fetchOwnMylistAll(
    mylistId: string,
    maxItems = 2000
  ): Promise<Array<{ videoId: string; title: string; thumbnailUrl: string; lengthSec: number; itemId: number }>> {
    const http = NicoContext.get().http;
    const pageSize = 100;
    const out: Array<{ videoId: string; title: string; thumbnailUrl: string; lengthSec: number; itemId: number }> = [];
    for (let page = 1; ; page++) {
      const res = await http.getJson<NicoNvapiMylistResponse>(NicoEndpoint.myMylist(mylistId, pageSize, page));
      const m = res.data?.mylist;
      // 応答の欠落を「空のマイリスト」と取り違えると、同期でローカルの項目が黙って消える
      if (!m) throw new Error('マイリストの応答が不正です (mylist がありません)');
      // 総数が分からないまま途中で打ち切ると、残りを「サーバーに無い」と誤判定して消してしまう
      if (typeof m.totalItemCount !== 'number') throw new Error('マイリストの応答が不正です (totalItemCount がありません)');
      const total = m.totalItemCount;
      if (total > maxItems) {
        throw new Error(`マイリストの動画が ${maxItems} 件を超えているため同期できません (${total} 件)`);
      }
      const items = m.items ?? [];
      for (const i of items) {
        out.push({
          // 削除・非公開になった動画は video が欠けることがあるので watchId を正とする
          videoId: i.watchId,
          title: i.video?.title ?? '',
          thumbnailUrl: i.video?.thumbnail?.url ?? '',
          lengthSec: i.video?.duration ?? 0,
          itemId: i.itemId
        });
      }
      if (items.length === 0 || out.length >= total) break;
    }
    this.ownItemIdCache.set(mylistId, new Map(out.map((i) => [i.videoId, i.itemId])));
    return out;
  }

  /**
   * 自分のマイリスト内の動画の itemId を返す。同期で得た分はキャッシュを使い、無ければ見つかるまでページ送りする
   * (全件は取らない)。見つからなければ undefined。
   */
  static async findOwnItemId(mylistId: string, videoId: string): Promise<number | undefined> {
    const cached = this.ownItemIdCache.get(mylistId)?.get(videoId);
    if (cached !== undefined) return cached;
    const http = NicoContext.get().http;
    const pageSize = 100;
    for (let page = 1; ; page++) {
      const res = await http.getJson<NicoNvapiMylistResponse>(NicoEndpoint.myMylist(mylistId, pageSize, page));
      const m = res.data?.mylist;
      const items = m?.items ?? [];
      let map = this.ownItemIdCache.get(mylistId);
      if (!map) this.ownItemIdCache.set(mylistId, (map = new Map()));
      for (const i of items) map.set(i.watchId, i.itemId);
      const hit = items.find((i) => i.watchId === videoId);
      if (hit) return hit.itemId;
      if (items.length === 0 || page * pageSize >= (m?.totalItemCount ?? 0)) return undefined;
    }
  }

  /**
   * 自分のマイリストの名前・説明文を更新する。
   * PUT は 5 項目 (name / description / isPublic / defaultSortKey / defaultSortOrder) を丸ごと置き換えるため、
   * 一部だけ送ると公開設定などが既定値に戻る。必ず現在の値を読んでから、変えたい項目だけ差し替えて送り直す。
   * description は現在の説明文を受け取って新しい説明文を返す関数で指定する (Web で書かれた内容を消さないため)。
   */
  static async updateMylist(
    mylistId: string,
    patch: { name?: string; description?: (current: string) => string }
  ): Promise<void> {
    const http = NicoContext.get().http;
    const res = await http.getJson<NicoNvapiMylistResponse>(NicoEndpoint.myMylist(mylistId, 1, 1));
    const m = res.data?.mylist;
    if (!m || m.isPublic === undefined || !m.defaultSortKey || !m.defaultSortOrder) {
      // 現在の設定を読み切れないときは、公開状態を変えてしまう恐れがあるので送らない
      throw new Error('マイリストの現在の設定を取得できなかったため、更新できません');
    }
    const current = m.description ?? '';
    await http.send('PUT', NicoEndpoint.myMylistById(mylistId), {
      form: {
        name: patch.name ?? m.name,
        description: patch.description ? patch.description(current) : current,
        isPublic: m.isPublic ? 'true' : 'false',
        defaultSortKey: m.defaultSortKey,
        defaultSortOrder: m.defaultSortOrder
      }
    });
  }

  /** 自分のマイリストの名前を変更する (公開設定・説明文などは変えない) */
  static async renameMylist(mylistId: string, name: string): Promise<void> {
    await this.updateMylist(mylistId, { name });
  }

  /**
   * 自分のマイリストの id / 名前 / 説明文の一覧 (軽量版。ページ送りなし)。
   * プレイリスト同期用マイリストの登録キーを探すのに使う。
   * GET /v1/users/me/mylists/compact
   */
  static async fetchOwnMylistsCompact(): Promise<Array<{ id: string; name: string; description: string }>> {
    const res = await NicoContext.get().http.getJson<{
      data?: { mylists?: Array<{ id: number | string; name: string; description?: string }> };
    }>(NicoEndpoint.myMylistsCompact());
    return (res.data?.mylists ?? []).map((m) => ({
      id: String(m.id),
      name: m.name,
      description: m.description ?? ''
    }));
  }

  /**
   * ログイン済みアカウントのマイリスト一覧を取得。
   * GET https://nvapi.nicovideo.jp/v1/users/me/mylists
   */
  static async fetchAccountMylists(excludeIds: ReadonlySet<string> = new Set()): Promise<MyList[]> {
    interface AccountMylistsResponse {
      meta?: { status?: number };
      data?: {
        mylists?: Array<{
          id: string | number;
          name: string;
          description?: string;
          status?: string;
          itemsCount?: number;
        }>;
      };
    }

    const ctx = NicoContext.get();
    const url = NicoEndpoint.myMylists();
    log.verbose('fetch account mylists:', url);
    const res = await ctx.http.getJson<AccountMylistsResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`アカウントマイリスト取得失敗: status=${status}`);
    }
    // プレイリスト同期用のマイリストは、普通のマイリストとして二重に出さない
    //  - この PC で同期中のプレイリストが持つ ID (excludeIds)
    //  - 説明文の目印 (別の PC で作ったもの・紐付けが消えたものも拾う)
    const raw = (res.data?.mylists ?? []).filter(
      (m) => !excludeIds.has(String(m.id)) && !(m.description ?? '').includes(PLAYLIST_SYNC_MARKER)
    );
    return raw.map((m) => ({
      myListUrl: mylistUrl(m.id),
      myListName: m.name,
      isDir: false,
      unPlayVideoCount: 0,
      type: RssType.MY_LIST,
      myListVideoIds: {}
    }));
  }

  /**
   * 指定ユーザーの投稿動画一覧を取得。
   * GET https://nvapi.nicovideo.jp/v3/users/{userId}/videos
   * 元: FollowFeedClient の getUserRecentVideos
   */
  static async fetchUserVideos(
    userId: string,
    page = 1,
    pageSize = 100,
    cacheImages = true
  ): Promise<{ items: MyListItem[]; total: number }> {
    interface NvApiUserVideosResponse {
      meta?: { status?: number };
      data?: {
        items?: Array<{
          essential?: {
            id?: string;
            title?: string;
            thumbnail?: { url?: string; middleUrl?: string };
            registeredAt?: string;
            count?: { view?: number; comment?: number; mylist?: number; like?: number };
            duration?: number;
          };
        }>;
        totalCount?: number;
      };
    }

    const ctx = NicoContext.get();
    const params = new URLSearchParams({
      sortKey: 'registeredAt',
      sortOrder: 'desc',
      pageSize: String(pageSize),
      page: String(page),
      // センシティブ (年齢制限等) 動画も含めて取得する。パラメータ名は sensitiveContents
      // (sensitive は API に無視され、未指定扱い=センシティブ動画が除外される)
      sensitiveContents: 'mask'
    });
    const url = NicoEndpoint.userVideos(userId, params);
    log.verbose('fetch user videos:', url);
    const res = await ctx.http.getJson<NvApiUserVideosResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`ユーザー投稿動画の取得に失敗: status=${status}`);
    }
    const rawItems = res.data?.items ?? [];
    const total = res.data?.totalCount ?? rawItems.length;
    let items = rawItems
      .map((it): MyListItem | null => {
        const e = it.essential;
        if (!e?.id) return null;
        return {
          videoId: e.id,
          title: e.title ?? e.id,
          description: '',
          thumbnailUrl: e.thumbnail?.middleUrl ?? e.thumbnail?.url ?? '',
          length: this.toLengthString(e.duration ?? 0),
          pubDate: e.registeredAt ? new Date(e.registeredAt) : new Date(0),
          viewCount: e.count?.view ?? 0,
          commentCount: e.count?.comment ?? 0,
          mylistCount: e.count?.mylist ?? 0,
          likeCount: e.count?.like ?? 0
        };
      })
      .filter((i): i is MyListItem => i !== null);
    if (cacheImages && ImageCache.isEnabled()) {
      const http = ctx.http;
      const urls = ImageCache.cacheUrlList(items.map(i => i.thumbnailUrl), http);
      items = items.map((i, idx) => ({ ...i, thumbnailUrl: urls[idx] }));
    }
    log.verbose(`user ${userId} page=${page} items=${items.length} total=${total}`);
    return { items, total };
  }

  /**
   * 指定ユーザーの公開マイリスト一覧を取得。
   * GET https://nvapi.nicovideo.jp/v1/users/{userId}/mylists
   */
  static async fetchByUserId(userId: string): Promise<UserMylistSummary[]> {
    interface NvApiUserMylistsResponse {
      meta?: { status?: number };
      data?: {
        mylists?: Array<{
          id: number | string;
          isPublic?: boolean;
          name: string;
          itemsCount?: number;
        }>;
      };
    }
    const url = NicoEndpoint.userMylists(userId);
    log.verbose('fetch user mylists:', url);
    const res = await NicoContext.get().http.getJson<NvApiUserMylistsResponse>(url);
    const status = res.meta?.status;
    if (status && status >= 400) {
      throw new Error(`ユーザーマイリスト一覧の取得に失敗: status=${status}`);
    }
    const raw = res.data?.mylists ?? [];
    return raw
      .filter((m) => m.isPublic !== false)
      .map((m) => ({
        id: String(m.id),
        name: m.name,
        itemsCount: m.itemsCount ?? 0
      }));
  }

  /**
   * ユーザーIDからニックネームを取得 (表示名用の軽量版)。
   */
  static async fetchUserName(userId: string): Promise<string | null> {
    interface NvApiUserResponse {
      data?: { user?: { nickname?: string } };
    }
    try {
      const res = await NicoContext.get().http.getJson<NvApiUserResponse>(
        NicoEndpoint.user(userId)
      );
      return res.data?.user?.nickname ?? null;
    } catch (e) {
      log.verbose(`fetchUserName failed for ${userId}:`, e);
      return null;
    }
  }

  private static toLengthString(durationSec: number): string {
    const m = Math.floor(durationSec / 60);
    const s = Math.floor(durationSec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
