import { NicoContext } from '../NicoContext';
import { NicoHeaders } from '@shared/constants';
import { createLogger } from '../../util/Logger';

const log = createLogger('LivePoc');

/**
 * ニコニコ生放送 視聴フロー調査用 PoC (設定 > デバッグ から実行)。
 *
 * watchページ解析 → 視聴WebSocket → HLS / NDGR(コメント) を1回ずつ叩き、
 * 実際のレスポンスをログと戻り値に出す。トークン・Cookie値はマスクする。
 * 本実装の方針が固まったら削除する想定。
 */

const LIVE_ORIGIN = 'https://live.nicovideo.jp';
const WS_WAIT_MS = 20_000;

interface StreamCookie {
  domain?: string;
  path?: string;
  name: string;
  value: string;
  secure?: boolean;
}

interface WsMessage {
  type: string;
  data?: Record<string, unknown>;
}

/** 秘匿値 (トークン・Cookie・ユーザーID) をマスクした文字列にする */
function mask(text: string): string {
  return text
    .replace(/(audience_token=)[^&"\s]+/g, '$1***')
    .replace(/("(?:value|csrfToken|audienceToken|hashedUserId|token|userId)"\s*:\s*")[^"]*"/g, '$1***"')
    .replace(/(user_session=)[^;"\s]+/g, '$1***');
}

function truncate(s: string, n = 1500): string {
  return s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** varint 長さプレフィックス付き protobuf ストリームを分割する (中身はデコードしない) */
function splitLengthDelimited(buf: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let len = 0;
    let shift = 0;
    let b: number;
    do {
      if (pos >= buf.length) return chunks;
      b = buf[pos++];
      len |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (pos + len > buf.length) return chunks;
    chunks.push(buf.subarray(pos, pos + len));
    pos += len;
  }
  return chunks;
}

/** バイナリ中の https URL を拾う (protobuf をデコードせずに segment URI 等を得るため) */
function extractUrls(buf: Uint8Array): string[] {
  const latin1 = Buffer.from(buf).toString('latin1');
  return [...new Set(latin1.match(/https:\/\/[\x21-\x7e]+/g) ?? [])];
}

/** protobuf メッセージを (fieldNo, wireType, value) に浅く分解する */
function readFields(buf: Uint8Array): Array<{ no: number; wt: number; v: bigint | Uint8Array }> {
  const fields: Array<{ no: number; wt: number; v: bigint | Uint8Array }> = [];
  let pos = 0;
  const varint = (): bigint => {
    let r = 0n;
    let shift = 0n;
    for (;;) {
      const b = buf[pos++];
      r |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return r;
      shift += 7n;
    }
  };
  while (pos < buf.length) {
    const tag = Number(varint());
    const no = tag >> 3;
    const wt = tag & 7;
    if (wt === 0) fields.push({ no, wt, v: varint() });
    else if (wt === 2) {
      const len = Number(varint());
      fields.push({ no, wt, v: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wt === 1) pos += 8;
    else if (wt === 5) pos += 4;
    else break;
  }
  return fields;
}

/** ChunkedEntry 列から next.at (field 4 → field 1) を探す */
function findNextAt(chunks: Uint8Array[]): string | null {
  for (const c of chunks) {
    for (const f of readFields(c)) {
      if (f.no === 4 && f.v instanceof Uint8Array) {
        const at = readFields(f.v).find((x) => x.no === 1);
        if (at && typeof at.v === 'bigint') return at.v.toString();
      }
    }
  }
  return null;
}

/** ストリーミングで返るレスポンスを最大 ms ミリ秒だけ読む */
async function fetchStreamed(
  url: string,
  ms: number
): Promise<{ status: number; type: string | null; buf: Buffer }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const parts: Uint8Array[] = [];
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    } catch {
      // abort による打ち切り
    }
    return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.concat(parts) };
  } finally {
    clearTimeout(t);
  }
}

/** Cookie の path が URL のパスに前方一致するものだけ送る (CloudFront 署名Cookieはパス別に複数来る) */
function cookieHeaderFor(url: string, cookies: StreamCookie[]): string {
  const pathname = new URL(url).pathname;
  return cookies
    .filter((c) => !c.path || pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function hexHead(buf: Uint8Array, n = 32): string {
  return Buffer.from(buf.subarray(0, n)).toString('hex');
}

export async function runLivePoc(rawId: string): Promise<string[]> {
  const out: string[] = [];
  const p = (line: string): void => {
    const m = mask(line);
    out.push(m);
    log.info(m);
  };

  const id = rawId.trim();
  const ctx = NicoContext.get();
  p(`=== LivePoc start: ${id} (loggedIn=${await ctx.isLoggedIn()}) ===`);

  // 1. watchページ → embedded-data
  const watchUrl = `${LIVE_ORIGIN}/watch/${id}`;
  let html: string;
  try {
    html = await ctx.http.getText(watchUrl, { headers: { Referer: `${LIVE_ORIGIN}/` } });
  } catch (e) {
    p(`[watch] fetch failed: ${String(e)}`);
    return out;
  }
  const m = html.match(/id="embedded-data"\s+data-props="([^"]*)"/);
  if (!m) {
    p(`[watch] embedded-data not found (html length=${html.length})`);
    return out;
  }
  const props = JSON.parse(decodeHtmlEntities(m[1])) as Record<string, any>;
  const program = props.program ?? {};
  const relive = props.site?.relive ?? {};
  p(`[watch] program: ${JSON.stringify({
    id: program.nicoliveProgramId,
    title: program.title,
    status: program.status,
    providerType: program.providerType,
    mediaServerType: program.mediaServerType,
    beginTime: program.beginTime,
    vposBaseTime: program.vposBaseTime,
    endTime: program.endTime
  })}`);
  p(`[watch] user: ${JSON.stringify({
    isLoggedIn: props.user?.isLoggedIn,
    accountType: props.user?.accountType
  })}`);
  p(`[watch] frontendId=${props.site?.frontendId} programTimeshift=${JSON.stringify(props.programTimeshift ?? null)}`);
  p(`[watch] site.relive keys: ${Object.keys(relive).join(',')}`);
  const wsUrl: string = relive.webSocketUrl ?? '';
  p(`[watch] webSocketUrl: ${wsUrl || '(empty)'}`);
  if (!wsUrl) return out;

  // 2. 視聴WebSocket
  const cookieHeader = await ctx.cookieStore.cookieHeader(watchUrl);
  const received: WsMessage[] = [];
  let stream: Record<string, unknown> | undefined;
  let messageServer: Record<string, unknown> | undefined;

  await new Promise<void>((resolve) => {
    // Node (undici) の WebSocket は第2引数オブジェクトで headers を渡せる (ブラウザ非互換の拡張)
    const WS = WebSocket as unknown as new (
      url: string,
      init: { headers: Record<string, string> }
    ) => WebSocket;
    const ws = new WS(wsUrl, {
      headers: {
        'User-Agent': NicoHeaders.USER_AGENT,
        Origin: LIVE_ORIGIN,
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      }
    });
    const timer = setTimeout(() => {
      p('[ws] timeout, closing');
      ws.close();
    }, WS_WAIT_MS);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };

    ws.addEventListener('open', () => {
      p('[ws] open');
      const start = {
        type: 'startWatching',
        data: {
          stream: { quality: 'abr', protocol: 'hls', latency: 'low', chasePlay: false },
          room: { protocol: 'webSocket', commentable: true },
          reconnect: false
        }
      };
      p(`[ws] send ${JSON.stringify(start)}`);
      ws.send(JSON.stringify(start));
    });
    ws.addEventListener('message', (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
      p(`[ws] recv ${truncate(text)}`);
      let msg: WsMessage;
      try {
        msg = JSON.parse(text) as WsMessage;
      } catch {
        return;
      }
      received.push(msg);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        ws.send(JSON.stringify({ type: 'keepSeat' }));
      }
      if (msg.type === 'stream') stream = msg.data;
      if (msg.type === 'messageServer') messageServer = msg.data;
      // stream と messageServer が揃い、少し他のメッセージも見てから閉じる
      if (stream && messageServer) {
        setTimeout(() => ws.close(), 3000);
      }
    });
    ws.addEventListener('error', (ev) => {
      p(`[ws] error ${String((ev as unknown as { message?: string }).message ?? ev.type)}`);
    });
    ws.addEventListener('close', (ev) => {
      p(`[ws] close code=${ev.code} reason=${ev.reason}`);
      finish();
    });
  });
  p(`[ws] received types: ${received.map((r) => r.type).join(',')}`);

  // 3. HLS
  const hlsUri = stream?.uri as string | undefined;
  if (hlsUri) {
    const cookies = (stream?.cookies as StreamCookie[] | undefined) ?? [];
    p(`[hls] cookies: ${cookies.map((c) => `${c.name}@${c.domain}${c.path}`).join(' , ')}`);
    const streamCookie = cookieHeaderFor(hlsUri, cookies);
    for (const withCookie of [false, true]) {
      if (withCookie && !streamCookie) continue;
      try {
        const res = await fetch(hlsUri, {
          headers: {
            'User-Agent': NicoHeaders.USER_AGENT,
            Origin: LIVE_ORIGIN,
            Referer: `${LIVE_ORIGIN}/`,
            ...(withCookie ? { Cookie: streamCookie } : {})
          }
        });
        const body = await res.text();
        p(`[hls] cookie=${withCookie} HTTP ${res.status} ${res.headers.get('content-type')} len=${body.length}`);
        p(`[hls] body: ${truncate(body, 800)}`);
        // variant.m3u8 が取れたら、その中の最初のメディアプレイリストも1つ取得してみる
        const firstVariant = res.ok ? body.split(/\r?\n/).find((l) => l && !l.startsWith('#')) : undefined;
        if (withCookie && firstVariant) {
          const vUrl = new URL(firstVariant, hlsUri).toString();
          const vr = await fetch(vUrl, {
            headers: {
              'User-Agent': NicoHeaders.USER_AGENT,
              Origin: LIVE_ORIGIN,
              Referer: `${LIVE_ORIGIN}/`,
              Cookie: cookieHeaderFor(vUrl, cookies)
            }
          });
          const vb = await vr.text();
          p(`[hls:media] ${vUrl.replace(/\?.*/, '')} HTTP ${vr.status} len=${vb.length}`);
          p(`[hls:media] body: ${truncate(vb, 600)}`);
        }
      } catch (e) {
        p(`[hls] cookie=${withCookie} fetch failed: ${String(e)}`);
      }
    }
  }

  // 4. NDGR (コメント)
  const viewUri = messageServer?.viewUri as string | undefined;
  if (viewUri) {
    const sep = viewUri.includes('?') ? '&' : '?';
    const nowUrl = `${viewUri}${sep}at=now`;
    const segmentUrls: string[] = [];
    for (const [label, headers] of [
      ['plain', {}],
      ['browserLike', { 'User-Agent': NicoHeaders.USER_AGENT, Origin: LIVE_ORIGIN, Referer: `${LIVE_ORIGIN}/` }]
    ] as const) {
      try {
        const res = await fetch(nowUrl, { headers });
        const buf = new Uint8Array(await res.arrayBuffer());
        const chunks = splitLengthDelimited(buf);
        const urls = extractUrls(buf);
        p(`[ndgr:view:${label}] HTTP ${res.status} ${res.headers.get('content-type')} bytes=${buf.length} chunks=${chunks.length} head=${hexHead(buf)}`);
        p(`[ndgr:view:${label}] urls: ${urls.join(' , ')}`);
        if (segmentUrls.length === 0) segmentUrls.push(...urls.filter((u) => u.includes('/segment/')));
      } catch (e) {
        p(`[ndgr:view:${label}] fetch failed: ${String(e)}`);
      }
    }
    // at=now は next.at だけ返す → at を辿ってストリーミング応答から segment URI を得る
    let at: string | null = null;
    try {
      const r0 = await fetch(nowUrl);
      at = findNextAt(splitLengthDelimited(new Uint8Array(await r0.arrayBuffer())));
    } catch (e) {
      p(`[ndgr:view] at=now failed: ${String(e)}`);
    }
    for (let i = 0; i < 3 && at && segmentUrls.length === 0; i++) {
      const r = await fetchStreamed(`${viewUri}${sep}at=${at}`, 8000);
      const chunks = splitLengthDelimited(r.buf);
      const urls = extractUrls(r.buf);
      p(`[ndgr:view at=${at}] HTTP ${r.status} ${r.type} bytes=${r.buf.length} chunks=${chunks.length} head=${hexHead(r.buf)}`);
      p(`[ndgr:view at=${at}] chunk field nos: ${chunks.map((c) => readFields(c).map((f) => f.no).join('/')).join(' ')}`);
      p(`[ndgr:view at=${at}] urls: ${urls.join(' , ')}`);
      segmentUrls.push(...urls.filter((u) => u.includes('/segment/')));
      at = findNextAt(chunks);
    }
    const seg = segmentUrls[0];
    if (seg) {
      try {
        // segment は配信中のコメントを流し続けるため、数秒で打ち切る
        const r = await fetchStreamed(seg, 8000);
        const chunks = splitLengthDelimited(r.buf);
        p(`[ndgr:segment] HTTP ${r.status} ${r.type} bytes=${r.buf.length} chunks=${chunks.length}`);
        // chat 本文は UTF-8 文字列として埋まっているので、先頭数件だけ可読部分を出す
        for (const c of chunks.slice(0, 8)) {
          const readable = Buffer.from(c).toString('utf-8').replace(/[\x00-\x1f\ufffd]+/g, ' ').trim();
          p(`[ndgr:segment] chunk len=${c.length} fields=${readFields(c).map((f) => f.no).join('/')} text="${truncate(readable, 200)}"`);
        }
      } catch (e) {
        p(`[ndgr:segment] fetch failed: ${String(e)}`);
      }
    }
  }

  p('=== LivePoc end ===');
  return out;
}
