import { NicoEndpoint } from '@shared/constants';
import type { LiveAnimeParams, LiveAnimeResult, LiveProgramSummary } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';

const log = createLogger('LiveAnimeClient');

/**
 * アニメ生放送 (anime.nicovideo.jp/live) の番組一覧。
 * 専用 API は無く、ページの inline script (`<script id="tktk-module">`) に `window.TKTK['live_*'] = [{ title: s("…"), … }]`
 * という JS が埋まっている。リモートのコードを実行しないよう、s()/n()/b()/d_s() の呼び出しだけを正規表現で読む。
 * 未ログインでも全件見える。ログイン中は `window.TKTK.user` に会員情報が入る
 */

/** 一覧のページ名 (anime.nicovideo.jp/live/<名前>.html、全て・放送予定は名前なし) と TKTK のキー */
function pageOf(params: LiveAnimeParams): { page: string; key: string } {
  const suffix = params.kind === 'all' ? '' : `-${params.kind}`;
  if (params.scope === 'past') return { page: `past${suffix}`, key: `live_past${suffix.replace('-', '_')}` };
  return {
    page: params.kind === 'all' ? '' : `reserved${suffix}`,
    key: `live_reserved${suffix.replace('-', '_')}`
  };
}

/** 項目1つの生の値: 文字列は s("…")、数値は n('…')、真偽は b('…')、日時 (JST) は d_s('…') */
type RawItem = Record<string, string | number | boolean>;

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#x27;': "'",
  '&#x60;': '`',
  '&#x2F;': '/',
  '&#x3D;': '='
};

/** サイト側 s() と同じ: JS 文字列リテラルを復元し、trim と HTML エンティティの復号をする */
function decodeJsString(raw: string): string {
  let v: string;
  try {
    v = JSON.parse(`"${raw.replace(/\\'/g, "'")}"`) as string;
  } catch {
    v = raw;
  }
  return v.trim().replace(/&(?:lt|gt|amp|quot|#x27|#x60|#x2F|#x3D);/g, (m) => ENTITIES[m] ?? m);
}

const VALUE_RE =
  /(\w+):(?:s\("((?:[^"\\]|\\.)*)"\)|n\('(-?\d*)'\)|b\('(\w*)'\)|d_s\('([^']*)'\))/g;

/** `window.TKTK['<key>'] = [ … ];` の配列部分から項目を読む。title が項目の先頭 */
function parseItems(script: string, key: string): RawItem[] {
  const head = script.indexOf(`window.TKTK['${key}']`);
  if (head < 0) return [];
  const next = script.indexOf('window.TKTK', head + 1);
  const body = script.slice(head, next < 0 ? undefined : next);
  const items: RawItem[] = [];
  let cur: RawItem | null = null;
  for (const m of body.matchAll(VALUE_RE)) {
    const [, name, str, nm, bl, date] = m;
    if (name === 'title') {
      cur = {};
      items.push(cur);
    }
    if (!cur) continue;
    if (str !== undefined) cur[name] = decodeJsString(str);
    else if (nm !== undefined) cur[name] = parseInt(nm || '0', 10);
    else if (bl !== undefined) cur[name] = bl.toLowerCase() === 'true';
    else if (date !== undefined) cur[name] = date;
  }
  return items;
}

/** サイトは日時を `new Date(v + '+09:00')` で読む (JST) */
function jstToMs(v: unknown): number {
  const t = typeof v === 'string' ? Date.parse(`${v}+09:00`) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const count = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function toSummary(it: RawItem): LiveProgramSummary | null {
  const programId = /lv\d+/.exec(text(it.contentId) || text(it.watchUrl))?.[0];
  if (!programId) return null;
  const title = text(it.title);
  const liveStatus = text(it.liveStatus).toLowerCase();
  const isPast = liveStatus === 'past';
  const expiredMs = jstToMs(it.timeshiftExpired);
  return {
    programId,
    title,
    thumbnailUrl: text(it.thumbnailHugeS352x198) || text(it.pictureUrl),
    status: isPast ? 'ENDED' : liveStatus === 'onair' ? 'ON_AIR' : 'RELEASED',
    beginAtMs: jstToMs(it.startTime),
    endAtMs: 0,
    viewers: count(it.viewCounter),
    comments: count(it.commentCounter),
    ownerName: 'ニコニコアニメ',
    ownerIconUrl: '',
    providerType: 'official',
    // 「【ニコニコプレミアム限定】」と題された番組。公式の一覧データに会員種別を示すフラグは無い
    isMemberOnly: title.includes('プレミアム限定'),
    timeshiftPlayable: isPast ? true : undefined,
    timeshiftViewingLimitMs: expiredMs || undefined,
    timeshiftEnabled: typeof it.timeshiftEnabled === 'boolean' ? it.timeshiftEnabled : undefined
  };
}

/** `window.TKTK.user` からログイン有無とプレミアム会員かを読む。ログイン中の形式は未確認なので isPremium は取れなければ null */
function parseUser(script: string): { isLoggedIn: boolean; isPremium: boolean | null } {
  const m = /window\.TKTK\.user\s*=\s*(null|\{[^;]*?\});/.exec(script);
  if (!m || m[1] === 'null') return { isLoggedIn: false, isPremium: null };
  const p = /isPremium:\s*(?:b\('(\w*)'\)|(true|false))/.exec(m[1]);
  const v = p?.[1] ?? p?.[2];
  log.info(`window.TKTK.user keys: ${[...m[1].matchAll(/(\w+):/g)].map((x) => x[1]).join(',')}`);
  return { isLoggedIn: true, isPremium: v === undefined ? null : v.toLowerCase() === 'true' };
}

/** nvapi /v1/users/me の isPremium。取れなければ null (ページ側の判定にフォールバックする) */
async function fetchIsPremium(): Promise<boolean | null> {
  try {
    const http = NicoContext.get().http;
    const res = await http.fetch(NicoEndpoint.me(), { timeoutMs: 8000 });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { user?: { isPremium?: unknown } } };
    const v = json.data?.user?.isPremium;
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

export async function fetchAnimeLivePrograms(params: LiveAnimeParams): Promise<LiveAnimeResult> {
  const { page, key } = pageOf(params);
  const html = await NicoContext.get().http.getText(NicoEndpoint.liveAnimePage(page), {
    headers: { Referer: 'https://anime.nicovideo.jp/' }
  });
  const script = /<script id="tktk-module">([\s\S]+?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error('アニメ生放送ページの解析に失敗しました');

  const programs = parseItems(script, key)
    .map(toSummary)
    .filter((p): p is LiveProgramSummary => p !== null);

  const user = parseUser(script);
  const isPremium = user.isLoggedIn ? ((await fetchIsPremium()) ?? user.isPremium) : null;
  log.info(`anime live ${key}: ${programs.length} 件, loggedIn=${user.isLoggedIn}, premium=${isPremium}`);
  return { programs, total: programs.length, isLoggedIn: user.isLoggedIn, isPremium };
}
