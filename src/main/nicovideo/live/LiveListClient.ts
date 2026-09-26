import type { LiveProgramListResult, LiveProgramSummary, LiveSearchParams } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { LIVE_ORIGIN, parseEmbeddedData } from './LiveWatchPage';

/**
 * 生放送の番組一覧 (フォロー中・検索・タイムシフト予約)。
 * いずれも非公式 API のため、レスポンスは必要なフィールドだけ防御的に読む。
 */

/** live.nicovideo.jp (PC Web) の frontendId。検索 API はこれがヘッダーに無いとエラーになる */
const LIVE_HEADERS = {
  'X-Frontend-Id': '9',
  Origin: LIVE_ORIGIN,
  Referer: `${LIVE_ORIGIN}/`
};

const SEARCH_LIMIT = 40;

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
export async function fetchFollowingPrograms(
  status: 'onair' | 'reserved',
  offset: number
): Promise<LiveProgramListResult> {
  const url = `${LIVE_ORIGIN}/front/api/pages/follow/v1/programs?status=${status}&offset=${offset}`;
  const json = await NicoContext.get().http.getJson<{ data?: { programs?: any[]; total?: number } }>(url, {
    headers: LIVE_HEADERS
  });
  const programs = (json.data?.programs ?? []).map(
    (p): LiveProgramSummary => ({
      programId: str(p.id),
      title: str(p.title),
      thumbnailUrl: str(p.listingThumbnail),
      status: normalizeStatus(p.liveCycle),
      beginAtMs: num(p.beginAt) ?? 0,
      endAtMs: num(p.endAt) ?? 0,
      viewers: num(p.statistics?.watchCount),
      comments: num(p.statistics?.commentCount),
      ownerName: str(p.socialGroup?.name),
      ownerIconUrl: str(p.socialGroup?.thumbnailUrl),
      providerType: str(p.providerType),
      isMemberOnly: Boolean(p.isFollowerOnly || p.isPayProgram),
      timeshiftPlayable: typeof p.timeshift?.isPlayable === 'boolean' ? p.timeshift.isPlayable : undefined
    })
  );
  return { programs, total: num(json.data?.total) ?? programs.length };
}

/** 番組検索 (api.cas.nicovideo.jp) */
export async function searchPrograms(params: LiveSearchParams): Promise<LiveProgramListResult> {
  const q = new URLSearchParams({
    searchWord: params.keyword,
    searchTargets: 'keyword',
    liveStatus: params.liveStatus,
    sort: params.sort,
    order: params.order,
    limit: String(SEARCH_LIMIT),
    offset: String(params.offset)
  });
  const json = await NicoContext.get().http.getJson<{ meta?: { totalCount?: number }; data?: any[] }>(
    `https://api.cas.nicovideo.jp/v2/search/programs.json?${q}`,
    { headers: LIVE_HEADERS }
  );
  const programs = (json.data ?? []).map(
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
  return { programs, total: num(json.meta?.totalCount) ?? programs.length };
}

/** タイムシフト予約一覧 (live.nicovideo.jp/embed/timeshift-reservations の embedded-data) */
export async function fetchTimeshiftReservations(): Promise<LiveProgramListResult> {
  const html = await NicoContext.get().http.getText(`${LIVE_ORIGIN}/embed/timeshift-reservations`, {
    headers: { Referer: `${LIVE_ORIGIN}/` }
  });
  const props = parseEmbeddedData(html);
  if (!props) throw new Error('タイムシフト予約一覧の解析に失敗しました');
  const list: any[] = props.reservations?.reservations ?? [];
  const programs = list.map(
    (r): LiveProgramSummary => ({
      programId: str(r.nicoliveProgramId),
      title: str(r.title),
      thumbnailUrl: str(r.listingThumbnail),
      status: normalizeStatus(r.status),
      beginAtMs: (num(r.beginTime) ?? 0) * 1000,
      endAtMs: (num(r.endTime) ?? 0) * 1000,
      viewers: num(r.statistics?.watchCount),
      comments: num(r.statistics?.commentCount),
      ownerName: '',
      ownerIconUrl: '',
      providerType: str(r.providerType),
      isMemberOnly: Boolean(r.isFollowerOnly || r.payment),
      timeshiftPlayable: typeof r.timeshift?.isPlayable === 'boolean' ? r.timeshift.isPlayable : undefined
    })
  );
  return { programs, total: programs.length };
}
