import type { LiveProgramInfo } from '@shared/types';
import { NicoContext } from '../NicoContext';

export const LIVE_ORIGIN = 'https://live.nicovideo.jp';

/** 生放送 watchページ解析結果 */
export interface LiveWatchPageInfo {
  program: LiveProgramInfo;
  /** 視聴WebSocketのURL。空なら視聴不可 (タイムシフト未予約・会員限定等) */
  webSocketUrl: string;
  isLoggedIn: boolean;
  /** タイムシフト公開状態 (programTimeshift.publication.status: Before / Open 等)。無ければ空 */
  timeshiftPublication: string;
}

/** タイムシフトの予約・視聴開始 (確認の上で実行する) が必要なことを示すエラーコード */
export const TIMESHIFT_ACTIVATION_REQUIRED = 'TIMESHIFT_ACTIVATION_REQUIRED';

/** 視聴できない理由を表すエラー (UI にそのまま表示できるメッセージを持つ) */
export class LiveUnavailableError extends Error {
  /**
   * @param code IPC 越しには message しか渡らないため、コードは message 先頭に `[CODE]` として埋め込む
   */
  constructor(message: string, code?: string) {
    super(code ? `[${code}] ${message}` : message);
    this.name = 'LiveUnavailableError';
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** live.nicovideo.jp の HTML から `#embedded-data` の data-props を取り出す。無ければ null */
export function parseEmbeddedData(html: string): Record<string, any> | null {
  const m = html.match(/id="embedded-data"\s+data-props="([^"]*)"/);
  return m ? (JSON.parse(decodeHtmlEntities(m[1])) as Record<string, any>) : null;
}

/** URL・番組ID文字列から lv/co/ch ID を取り出す。取れなければ null */
export function normalizeLiveId(input: string): string | null {
  const m = input.trim().match(/\b(lv\d+|co\d+|ch\d+)\b/);
  return m ? m[1] : null;
}

/** 秒 (unix) → ms。値が無ければ 0 */
const secToMs = (v: unknown): number => (typeof v === 'number' ? v * 1000 : 0);

/**
 * `live.nicovideo.jp/watch/{id}` を取得し、`#embedded-data` の data-props を解析する。
 * co/ch ID を渡した場合は現在の放送にリダイレクトされる。
 */
export async function fetchLiveWatchPage(id: string): Promise<LiveWatchPageInfo> {
  const html = await NicoContext.get().http.getText(`${LIVE_ORIGIN}/watch/${id}`, {
    headers: { Referer: `${LIVE_ORIGIN}/` }
  });
  // embedded-data は外部データなので必要なフィールドだけ防御的に読む
  const props = parseEmbeddedData(html);
  if (!props) throw new Error('生放送ページの解析に失敗しました (embedded-data が見つかりません)');
  const program = props.program ?? {};
  const socialGroup = props.socialGroup ?? {};

  const info: LiveProgramInfo = {
    programId: String(program.nicoliveProgramId ?? id),
    title: String(program.title ?? ''),
    status: String(program.status ?? ''),
    providerType: String(program.providerType ?? ''),
    supplierName: String(program.supplier?.name ?? socialGroup.name ?? ''),
    beginTimeMs: secToMs(program.beginTime),
    endTimeMs: secToMs(program.endTime),
    vposBaseTimeMs: secToMs(program.vposBaseTime),
    thumbnailUrl: String(
      program.thumbnail?.huge?.s640x360 ??
        program.thumbnail?.small ??
        socialGroup.thumbnailImageUrl ??
        ''
    )
  };

  return {
    program: info,
    webSocketUrl: String(props.site?.relive?.webSocketUrl ?? ''),
    isLoggedIn: Boolean(props.user?.isLoggedIn),
    timeshiftPublication: String(props.programTimeshift?.publication?.status ?? '')
  };
}

/** webSocketUrl が空のとき、ユーザーに見せる理由を推定したエラーを作る */
export function unavailableError(page: LiveWatchPageInfo): LiveUnavailableError {
  if (page.isLoggedIn && page.program.status === 'ENDED' && page.timeshiftPublication === 'Open') {
    return new LiveUnavailableError(
      'タイムシフトを視聴するには、予約と視聴開始の操作が必要です。',
      TIMESHIFT_ACTIVATION_REQUIRED
    );
  }
  return new LiveUnavailableError(describeUnavailable(page));
}

/** webSocketUrl が空のとき、ユーザーに見せる理由を推定する */
export function describeUnavailable(page: LiveWatchPageInfo): string {
  const { status } = page.program;
  if (!page.isLoggedIn) return 'ログインしていないため視聴できません。';
  if (status === 'ENDED') return 'この番組は終了しています (タイムシフト未予約、または公開期間外の可能性があります)。';
  if (status === 'RELEASED') return 'この番組はまだ開始していません。';
  return 'この番組は視聴できません (会員限定・視聴権が必要な番組の可能性があります)。';
}

/**
 * タイムシフトの予約 → 視聴開始 を行う。
 * 視聴開始 (PATCH) で視聴期限のカウントが始まり取り消せないため、必ずユーザー確認後に呼ぶこと。
 */
export async function activateTimeshift(programId: string): Promise<void> {
  const url = `https://live2.nicovideo.jp/api/v2/programs/${programId}/timeshift/reservation`;
  const headers = { 'X-Frontend-Id': '9', Origin: LIVE_ORIGIN, Referer: `${LIVE_ORIGIN}/` };
  const http = NicoContext.get().http;

  // 予約 (既に予約済みなら errorCode=DUPLICATED が返るので無視する)
  const reserve = await http.fetch(url, { method: 'POST', headers });
  if (!reserve.ok) {
    const body = (await reserve.json().catch(() => ({}))) as { meta?: { errorCode?: string } };
    if (body.meta?.errorCode !== 'DUPLICATED') {
      throw new Error(`タイムシフトの予約に失敗しました (HTTP ${reserve.status} ${body.meta?.errorCode ?? ''})`.trim());
    }
  }
  // 視聴開始
  const use = await http.fetch(url, { method: 'PATCH', headers });
  if (!use.ok) {
    const body = (await use.json().catch(() => ({}))) as { meta?: { errorCode?: string } };
    throw new Error(`タイムシフトの視聴開始に失敗しました (HTTP ${use.status} ${body.meta?.errorCode ?? ''})`.trim());
  }
}
