import type { LiveProgramInfo } from '@shared/types';
import { NicoContext } from '../NicoContext';

export const LIVE_ORIGIN = 'https://live.nicovideo.jp';

/** 生放送 watchページ解析結果 */
export interface LiveWatchPageInfo {
  program: LiveProgramInfo;
  /** 視聴WebSocketのURL。空なら視聴不可 (タイムシフト未予約・会員限定等) */
  webSocketUrl: string;
  isLoggedIn: boolean;
}

/** 視聴できない理由を表すエラー (UI にそのまま表示できるメッセージを持つ) */
export class LiveUnavailableError extends Error {
  constructor(message: string) {
    super(message);
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
  const m = html.match(/id="embedded-data"\s+data-props="([^"]*)"/);
  if (!m) throw new Error('生放送ページの解析に失敗しました (embedded-data が見つかりません)');

  // embedded-data は外部データなので必要なフィールドだけ防御的に読む
  const props = JSON.parse(decodeHtmlEntities(m[1])) as Record<string, any>;
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
    isLoggedIn: Boolean(props.user?.isLoggedIn)
  };
}

/** webSocketUrl が空のとき、ユーザーに見せる理由を推定する */
export function describeUnavailable(page: LiveWatchPageInfo): string {
  const { status } = page.program;
  if (!page.isLoggedIn) return 'ログインしていないため視聴できません。';
  if (status === 'ENDED') return 'この番組は終了しています (タイムシフト未予約、または公開期間外の可能性があります)。';
  if (status === 'RELEASED') return 'この番組はまだ開始していません。';
  return 'この番組は視聴できません (会員限定・視聴権が必要な番組の可能性があります)。';
}
