import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';

const log = createLogger('SeriesClient');

export interface SeriesVideoItem {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  length: string;
  pubDate: string;
  viewCount: number;
  commentCount: number;
  mylistCount: number;
  likeCount: number;
}

export interface SeriesFetchResult {
  name: string;
  items: SeriesVideoItem[];
  page: number;
  totalPages: number;
}

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

function toLength(sec: number): string {
  const h = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return h > 0
    ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
}

function toThumb(t: SeriesVideo['thumbnail']): string {
  if (!t) return '';
  if (typeof t.url === 'string') return t.url;
  if (t.url && typeof t.url === 'object') return (t.url as { listingMedium?: string }).listingMedium ?? '';
  return '';
}

function mapItems(items: Array<{ video: SeriesVideo }>): SeriesVideoItem[] {
  return items.map((i) => ({
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
}

/**
 * ニコニコ「シリーズ」動画一覧クライアント。
 * 元は registerIpc.ts の SERIES_FETCH ハンドラに直書きされていたロジックを
 * SeriesAutoDownloader (スケジュール自動DL) からも再利用できるよう切り出したもの。
 */
export class SeriesClient {
  /** URL または数字文字列からシリーズIDを抽出 */
  static extractSeriesId(seriesIdOrUrl: string): string | null {
    const s = String(seriesIdOrUrl);
    const m = s.match(/series\/(\d+)/) ?? s.match(/^(\d+)$/);
    return m ? m[1] : null;
  }

  private static async fetchPageRaw(id: string, page: number): Promise<SeriesRes> {
    const url = `https://nvapi.nicovideo.jp/v2/series/${encodeURIComponent(id)}?pageSize=${PAGE_SIZE}&page=${page}`;
    log.debug('fetch series page %d:', page, url);
    return NicoContext.get().http.getJson<SeriesRes>(url);
  }

  /**
   * 指定ページ (省略時はページ1、currentVideoId指定時はそれを含むページを自動検出) を取得。
   */
  static async fetchPage(
    seriesIdOrUrl: string,
    requestedPage?: number,
    currentVideoId?: string
  ): Promise<SeriesFetchResult> {
    const id = this.extractSeriesId(seriesIdOrUrl);
    if (!id) throw new Error(`invalid series id: ${seriesIdOrUrl}`);

    const mkResult = (
      items: SeriesVideoItem[],
      name: string,
      page: number,
      totalPages: number
    ): SeriesFetchResult => ({ name, items, page, totalPages });

    // ページ指定あり → そのページを直接取得
    if (requestedPage && requestedPage >= 1) {
      const res = await this.fetchPageRaw(id, requestedPage);
      if (res.meta?.status && res.meta.status >= 400) {
        throw new Error(`シリーズ取得失敗: status=${res.meta.status}`);
      }
      const name = res.data?.detail?.title ?? `シリーズ ${id}`;
      const totalCount = res.data?.totalCount ?? 0;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
      return mkResult(mapItems(res.data?.items ?? []), name, requestedPage, totalPages);
    }

    // 初回ロード: ページ1取得 → currentVideoId のページを自動検出
    const firstRes = await this.fetchPageRaw(id, 1);
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
      const res = await this.fetchPageRaw(id, p);
      const items = mapItems(res.data?.items ?? []);
      if (items.some((i) => i.videoId === currentVideoId)) {
        return mkResult(items, name, p, totalPages);
      }
    }

    return mkResult(firstItems, name, 1, totalPages);
  }

  /** シリーズ全体の動画一覧を全ページ分まとめて取得 (自動DL用) */
  static async fetchAllVideos(
    seriesIdOrUrl: string
  ): Promise<{ name: string; items: SeriesVideoItem[] }> {
    const first = await this.fetchPage(seriesIdOrUrl, 1);
    const items = [...first.items];
    for (let p = 2; p <= first.totalPages; p++) {
      const res = await this.fetchPage(seriesIdOrUrl, p);
      items.push(...res.items);
    }
    return { name: first.name, items };
  }
}
