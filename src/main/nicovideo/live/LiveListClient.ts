import { LIVE_SEARCH_PAGE_SIZE } from '@shared/types';
import { NicoEndpoint, NicoHeaders } from '@shared/constants';
import type {
  LiveProgramListResult,
  LiveProgramSummary,
  LiveRankingParams,
  LiveRankingResult,
  LiveRecentParams,
  LiveSearchParams
} from '@shared/types';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { LIVE_ORIGIN, LiveUnavailableError, fetchLiveWatchPage, parseEmbeddedData } from './LiveWatchPage';
import { extractLiveIdFromInput } from '@shared/utils/liveId';
import type {
  NicoLiveEmbeddedData,
  NicoLiveEmbeddedProgram,
  NicoLiveFollowProgram,
  NicoLiveFollowResponse,
  NicoLiveRankingItem,
  NicoLiveRecentResponse,
  NicoLiveSearchResponse
} from '../apiTypes';

const log = createLogger('LiveListClient');

/**
 * 生放送の番組一覧 (フォロー中・検索・タイムシフト予約)。
 * いずれも非公式 API のため、レスポンスは必要なフィールドだけ防御的に読む。
 */

/** live.nicovideo.jp (PC Web) の frontendId。検索 API はこれがヘッダーに無いとエラーになる */
const LIVE_HEADERS = {
  'X-Frontend-Id': NicoHeaders.LIVE_FRONTEND_ID,
  Origin: LIVE_ORIGIN,
  Referer: `${LIVE_ORIGIN}/`
};

/** 番組検索 API の1回の取得件数 (20 を超えると invalid limit エラーになる) */
const SEARCH_LIMIT = 20;
/** 番組検索の1ページの件数 (SEARCH_LIMIT の倍数) */
const SEARCH_PAGE_SIZE = LIVE_SEARCH_PAGE_SIZE;

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isoToMs = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** API ごとに表記が違う放送状態を ON_AIR / RELEASED / ENDED に揃える */
function normalizeStatus(v: unknown): string {
  const s = str(v).toUpperCase();
  if (s === 'ON_AIR' || s === 'ONAIR') return 'ON_AIR';
  if (s === 'ENDED' || s === 'PAST') return 'ENDED';
  if (s === 'BEFORE_OPEN' || s === 'RESERVED' || s === 'RELEASED' || s === 'COMING_SOON') return 'RELEASED';
  return s;
}

/** フォロー中の番組 (live.nicovideo.jp/follow が使う API) */
/** フォロー中 API (/front/api/pages/follow/v1/programs) 形式の番組 */
function fromFollowApiProgram(p: NicoLiveFollowProgram): LiveProgramSummary {
  return {
    programId: str(p.id),
    title: str(p.title),
    thumbnailUrl: str(p.listingThumbnail),
    status: normalizeStatus(p.liveCycle),
    beginAtMs: num(p.beginAt) ?? 0,
    endAtMs: num(p.endAt) ?? 0,
    viewers: num(p.statistics?.watchCount),
    comments: num(p.statistics?.commentCount),
    ownerName: str(p.socialGroup?.name) || str(p.programProvider?.name),
    ownerIconUrl: str(p.socialGroup?.thumbnailUrl) || str(p.programProvider?.icon),
    providerType: str(p.providerType),
    isMemberOnly: Boolean(p.isFollowerOnly || p.isPayProgram),
    timeshiftPlayable: typeof p.timeshift?.isPlayable === 'boolean' ? p.timeshift.isPlayable : undefined
  };
}

/**
 * フォロー中の番組。
 * - onair: live.nicovideo.jp/follow が使う API
 * - reserved (放送予定): API の status 指定では取れないため、/follow ページの埋め込みデータ
 *   (followedPrograms.comingsoonProgramListState) から読む
 */
export async function fetchFollowingPrograms(
  status: 'onair' | 'reserved',
  offset: number
): Promise<LiveProgramListResult> {
  if (status === 'reserved') return fetchFollowingComingSoon();
  const url = NicoEndpoint.liveFollowPrograms(status, offset);
  const json = await NicoContext.get().http.getJson<NicoLiveFollowResponse>(url, {
    headers: LIVE_HEADERS
  });
  const programs = (json.data?.programs ?? []).map(fromFollowApiProgram);
  return { programs, total: num(json.data?.total) ?? programs.length };
}

async function fetchFollowingComingSoon(): Promise<LiveProgramListResult> {
  const props = await fetchEmbeddedData('/follow', 'フォロー中の番組');
  const state = props.followedPrograms?.comingsoonProgramListState;
  const items = state?.domain?.items ?? [];
  const programs = items
    // ランキング等と同じ { type, value } 形式と、API と同じ形式の両方に対応する
    .map((item) => item?.value ?? item)
    .filter((v) => v && (v.nicoliveProgramId || v.id))
    .map((v) => (v.nicoliveProgramId ? fromEmbeddedProgram(v) : fromFollowApiProgram(v)))
    // 放送予定は開始が近い順
    .sort((a, b) => a.beginAtMs - b.beginAtMs);
  return { programs, total: num(state?.totalProgramsCount) ?? programs.length };
}

/** 番組ページから1件分の番組情報を取る。取得できなければ null */
async function fetchProgramById(id: string): Promise<LiveProgramSummary | null> {
  try {
    const { program: p } = await fetchLiveWatchPage(id);
    return {
      programId: p.programId,
      title: p.title,
      thumbnailUrl: p.thumbnailUrl,
      status: normalizeStatus(p.status),
      beginAtMs: p.beginTimeMs,
      endAtMs: p.endTimeMs,
      comments: p.commentCount,
      ownerName: p.supplierName,
      ownerIconUrl: p.supplier?.iconUrl ?? '',
      providerType: p.providerType,
      isMemberOnly: false
    };
  } catch (e) {
    // 理由をユーザーに見せられるエラーは、キーワード検索に落とさず呼び出し元へ返す
    if (e instanceof LiveUnavailableError) throw e;
    log.warn('fetchProgramById failed:', id, e);
    return null;
  }
}

/** 番組検索 (api.cas.nicovideo.jp) */
export async function searchPrograms(params: LiveSearchParams): Promise<LiveProgramListResult> {
  // 検索 API は番組IDでは引けないため、ID/URL が入力された場合は番組ページから直接取得する
  const liveId = params.offset === 0 ? extractLiveIdFromInput(params.keyword) : null;
  if (liveId) {
    const program = await fetchProgramById(liveId);
    if (program) return { programs: [program], total: 1 };
  }
  // API は 1 回 20 件までなので、1 ページ分 (SEARCH_PAGE_SIZE 件) を並行して取得してつなげる
  const offsets = Array.from({ length: SEARCH_PAGE_SIZE / SEARCH_LIMIT }, (_, i) => params.offset + i * SEARCH_LIMIT);
  const responses = await Promise.all(
    offsets.map((offset, i) =>
      fetchSearchPage(params, offset).catch((e) => {
        // 先頭が失敗したらエラー、2 回目以降は件数の末尾を超えた等として空扱い
        if (i === 0) throw e;
        return { meta: undefined, data: [] };
      })
    )
  );
  const total = num(responses[0].meta?.totalCount);
  const seen = new Set<string>();
  const data = responses
    .flatMap((r) => r.data ?? [])
    .filter((p) => {
      const id = str(p?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const programs = data.map(
    (p): LiveProgramSummary => ({
      programId: str(p.id),
      title: str(p.title),
      thumbnailUrl: str(
        p.listingThumbnailUrl?.middle ||
          p.thumbnailUrl?.listingMiddle ||
          p.liveScreenshotThumbnailUrls?.middle ||
          p.thumbnailUrl?.normal
      ),
      status: normalizeStatus(p.liveCycle),
      beginAtMs: isoToMs(p.onAirTime?.beginAt ?? p.beginAt),
      endAtMs: isoToMs(p.onAirTime?.endAt ?? p.endAt),
      viewers: num(p.viewCount),
      comments: num(p.commentCount),
      ownerName: str(p.contentOwner?.name),
      ownerIconUrl: str(p.contentOwner?.icon),
      providerType: str(p.providerType),
      isMemberOnly: Boolean(p.isMemberOnly || p.isPayProgram),
      timeshiftPlayable: undefined
    })
  );
  return { programs, total: total ?? programs.length };
}

function fetchSearchPage(params: LiveSearchParams, offset: number): Promise<NicoLiveSearchResponse> {
  const q = new URLSearchParams({
    searchWord: params.keyword,
    searchTargets: 'keyword',
    liveStatus: params.liveStatus,
    sort: params.sort,
    order: params.order,
    limit: String(SEARCH_LIMIT),
    offset: String(offset)
  });
  return NicoContext.get().http.getJson<NicoLiveSearchResponse>(
    NicoEndpoint.liveSearchPrograms(q),
    { headers: LIVE_HEADERS }
  );
}

/** 秒・ミリ秒どちらで来ても ms に揃える (embedded-data の beginTime は秒) */
const toMs = (v: unknown): number => {
  const n = num(v) ?? 0;
  return n > 0 && n < 1e12 ? n * 1000 : n;
};

/**
 * live.nicovideo.jp のページ埋め込みデータに含まれる番組 (タイムシフト予約一覧・ランキング等で共通の形式)
 */
function fromEmbeddedProgram(r: NicoLiveEmbeddedProgram): LiveProgramSummary {
  return {
    programId: str(r.nicoliveProgramId),
    title: str(r.title),
    thumbnailUrl: str(r.listingThumbnail),
    status: normalizeStatus(r.status),
    beginAtMs: toMs(r.beginTime),
    endAtMs: toMs(r.endTime),
    viewers: num(r.statistics?.watchCount),
    comments: num(r.statistics?.commentCount),
    ownerName: str(r.supplier?.name) || str(r.socialGroup?.name),
    ownerIconUrl:
      str(r.socialGroup?.thumbnailUrl) ||
      str(r.supplier?.icons?.uri50x50) ||
      str(r.supplier?.icons?.uri150x150),
    providerType: str(r.providerType),
    isMemberOnly: Boolean(r.isFollowerOnly || r.payment),
    timeshiftPlayable: typeof r.timeshift?.isPlayable === 'boolean' ? r.timeshift.isPlayable : undefined,
    ...timeshiftDeadlines(r)
  };
}

/**
 * タイムシフトの視聴期限・公開終了の時刻。埋め込みデータのキー名は未確認のため、
 * 想定される候補を順に見る (取れなければ入れない)。タイムシフト予約一覧の取得時に実際の形をログに出す
 */
function timeshiftDeadlines(r: NicoLiveEmbeddedProgram): Pick<LiveProgramSummary, 'timeshiftViewingLimitMs' | 'timeshiftPublicationEndMs'> {
  const pick = (...vals: unknown[]): number | undefined => {
    for (const v of vals) {
      const ms = typeof v === 'string' ? isoToMs(v) : toMs(v);
      if (ms > 0) return ms;
    }
    return undefined;
  };
  return {
    timeshiftViewingLimitMs: pick(
      r.timeshift?.viewing?.endTime,
      r.timeshift?.viewingEndTime,
      r.timeshift?.expireTime,
      r.reservation?.expireTime,
      r.expireTime
    ),
    timeshiftPublicationEndMs: pick(
      r.timeshift?.publication?.endTime,
      r.timeshift?.publicationEndTime,
      r.timeshiftPublicationEndTime
    )
  };
}

async function fetchEmbeddedData(path: string, label: string): Promise<NicoLiveEmbeddedData> {
  const html = await NicoContext.get().http.getText(`${LIVE_ORIGIN}${path}`, {
    headers: { Referer: `${LIVE_ORIGIN}/` }
  });
  const props = parseEmbeddedData(html);
  if (!props) throw new Error(`${label}の解析に失敗しました`);
  return props;
}

/** タイムシフト予約一覧 (live.nicovideo.jp/embed/timeshift-reservations の embedded-data) */
export async function fetchTimeshiftReservations(): Promise<LiveProgramListResult> {
  const props = await fetchEmbeddedData('/embed/timeshift-reservations', 'タイムシフト予約一覧');
  const items = props.reservations?.reservations ?? [];
  if (items[0]) {
    // 視聴期限などのキー名を確認するため、先頭1件の timeshift 関連を残す
    const { timeshift, reservation } = items[0];
    log.info(`timeshift reservation sample: ${JSON.stringify({ timeshift, reservation }).slice(0, 1500)}`);
  }
  const programs = items.map(fromEmbeddedProgram);
  return { programs, total: programs.length };
}

/**
 * 生放送ランキング (live.nicovideo.jp/ranking の embedded-data)。
 * 専用 API は無く、ページに埋め込まれた ranking.{officialAndChannelPrograms, userPrograms} を読む。
 * 各要素は { type: 'seed', value: 番組 } 形式
 */
export async function fetchLiveRanking(params: LiveRankingParams): Promise<LiveRankingResult> {
  const q = new URLSearchParams({ type: params.type });
  if (params.type === 'closed' && params.date && /^\d{8}$/.test(params.date)) q.set('select_date', params.date);
  const props = await fetchEmbeddedData(`/ranking?${q}`, 'ランキング');
  const pick = (list: unknown): LiveProgramSummary[] =>
    (Array.isArray(list) ? list : [])
      .map((item: NicoLiveRankingItem) => item?.value ?? item)
      .filter((v) => v && v.nicoliveProgramId)
      .map(fromEmbeddedProgram);
  return {
    official: pick(props.ranking?.officialAndChannelPrograms),
    user: pick(props.ranking?.userPrograms)
  };
}

/**
 * カテゴリ別の放送中番組 (live.nicovideo.jp/recent が使う API)。
 * offset は件数ではなくページ番号 (1 ページ 70 件)
 */
export async function fetchRecentPrograms(params: LiveRecentParams): Promise<LiveProgramListResult> {
  const q = new URLSearchParams({
    tab: params.category,
    offset: String(params.page),
    sortOrder: params.sortOrder
  });
  const json = await NicoContext.get().http.getJson<NicoLiveRecentResponse>(
    NicoEndpoint.liveRecentPrograms(q),
    { headers: LIVE_HEADERS }
  );
  const programs = (json.data ?? []).map(
    (p): LiveProgramSummary => ({
      programId: str(p.id),
      title: str(p.title),
      thumbnailUrl: str(p.listingThumbnail),
      status: normalizeStatus(p.liveCycle),
      beginAtMs: num(p.beginAt) ?? 0,
      endAtMs: num(p.endAt) ?? 0,
      viewers: num(p.statistics?.watchCount),
      comments: num(p.statistics?.commentCount),
      ownerName: str(p.programProvider?.name) || str(p.socialGroup?.name),
      ownerIconUrl: str(p.programProvider?.icon) || str(p.socialGroup?.thumbnailUrl),
      providerType: str(p.providerType),
      isMemberOnly: Boolean(p.isFollowerOnly || p.isPayProgram),
      timeshiftPlayable: typeof p.timeshift?.isPlayable === 'boolean' ? p.timeshift.isPlayable : undefined
    })
  );
  return { programs, total: num(json.meta?.totalCount) ?? programs.length };
}
