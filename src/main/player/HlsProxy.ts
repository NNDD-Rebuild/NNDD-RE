import { NicoContext } from '../nicovideo/NicoContext';
import { createLogger } from '../util/Logger';

const log = createLogger('HlsProxy');

/**
 * HLS プロキシの URL タイプ
 * m3u8: プレイリスト (URL 書き換えて返す)
 * seg:  TS/MP4 セグメント (バイナリそのまま)
 * key:  AES-128 鍵 (バイナリそのまま)
 */
export type HlsProxyType = 'm3u8' | 'seg' | 'key';

/** 元 URL を base64url エンコードしてプロキシ URL を生成 */
export function encodeProxyUrl(originalUrl: string, type: HlsProxyType, proxyBase: string): string {
  const encoded = Buffer.from(originalUrl).toString('base64url');
  const sep = proxyBase.includes('?') ? '&' : '?';
  return `${proxyBase}${sep}url=${encoded}&t=${type}`;
}

/** プロキシ URL に含まれる base64url をデコードして元 URL に戻す */
export function decodeProxyUrl(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

/** rewriteM3u8 の戻り値 */
export interface M3u8Meta {
  text: string;
  /** メディアセグメントの original URL (順序通り) */
  segments: string[];
  /** EXT-X-MAP の original URL (init セグメント) */
  initSegmentUrl?: string;
  /** EXT-X-ENDLIST が含まれていた */
  isEndList: boolean;
  /** EXT-X-STREAM-INF を含む master playlist */
  isVariant: boolean;
}

/**
 * m3u8 テキスト内の URL をプロキシ経由に書き換える。
 * - EXT-X-STREAM-INF 直後のバリアント URL
 * - EXT-X-MEDIA の URI="..."
 * - EXT-X-KEY の URI="..."
 * - セグメント URL 行 (.ts / .m4s / クエリ付き)
 */
export function rewriteM3u8(text: string, baseUrl: string, proxyBase: string): M3u8Meta {
  const lines = text.split('\n');
  const out: string[] = [];
  let nextLineIsVariant = false;
  const segments: string[] = [];
  let initSegmentUrl: string | undefined;
  let isEndList = false;
  let isVariant = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (line === '#EXT-X-ENDLIST') {
      isEndList = true;
      out.push(line);
      continue;
    }

    // EXT-X-STREAM-INF: 次の行がバリアント URL
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isVariant = true;
      out.push(line);
      nextLineIsVariant = true;
      continue;
    }

    if (nextLineIsVariant) {
      nextLineIsVariant = false;
      if (line && !line.startsWith('#')) {
        const abs = resolveUrl(line, baseUrl);
        out.push(encodeProxyUrl(abs, 'm3u8', proxyBase));
        continue;
      }
    }

    // EXT-X-MEDIA: URI="..." を書き換え
    if (line.startsWith('#EXT-X-MEDIA:')) {
      out.push(rewriteTagUri(line, baseUrl, proxyBase, 'm3u8'));
      continue;
    }

    // EXT-X-MAP: URI="..." を書き換え (init segment: .cmfv / .cmfa / .mp4)
    if (line.startsWith('#EXT-X-MAP:')) {
      // init segment URL を抽出
      const m = line.match(/URI="([^"]+)"/);
      if (m) {
        initSegmentUrl = resolveUrl(m[1], baseUrl);
      }
      out.push(rewriteTagUri(line, baseUrl, proxyBase, 'seg'));
      continue;
    }

    // EXT-X-KEY: URI="..." を書き換え
    if (line.startsWith('#EXT-X-KEY:')) {
      out.push(rewriteTagUri(line, baseUrl, proxyBase, 'key'));
      continue;
    }

    // セグメント URL 行 (# で始まらず空でない)
    if (line && !line.startsWith('#')) {
      const abs = resolveUrl(line, baseUrl);
      segments.push(abs);
      out.push(encodeProxyUrl(abs, 'seg', proxyBase));
      continue;
    }

    out.push(line);
  }

  return { text: out.join('\n'), segments, initSegmentUrl, isEndList, isVariant };
}

/** URI="..." 属性を持つタグ行の URI を書き換える */
function rewriteTagUri(line: string, baseUrl: string, proxyBase: string, type: HlsProxyType): string {
  return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
    const abs = resolveUrl(uri, baseUrl);
    return `URI="${encodeProxyUrl(abs, type, proxyBase)}"`;
  });
}

/** 相対 URL を絶対 URL に解決する */
function resolveUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/**
 * プロキシリクエストを処理する。
 * NicoHttp で Cookie 付きリクエストを送り、レスポンスを返す。
 */
export async function handleProxyRequest(
  encodedUrl: string,
  type: HlsProxyType,
  proxyBase: string
): Promise<{ body: Buffer; contentType: string; m3u8Meta?: M3u8Meta }> {
  const originalUrl = decodeProxyUrl(encodedUrl);
  log.verbose(`proxy ${type}: ${originalUrl.slice(0, 120)}`);

  const http = NicoContext.get().http;

  if (type === 'm3u8') {
    const text = await http.getText(originalUrl);
    const meta = rewriteM3u8(text, originalUrl, proxyBase);
    return {
      body: Buffer.from(meta.text, 'utf8'),
      contentType: 'application/vnd.apple.mpegurl',
      m3u8Meta: meta
    };
  }

  // seg / key: バイナリそのまま
  const buf = await http.getBinary(originalUrl);
  const contentType = type === 'key' ? 'application/octet-stream' : 'video/MP2T';
  return { body: buf, contentType };
}
