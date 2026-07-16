import type {
  HlsStreamInfo,
  HlsAudioInfo,
  HlsSegment,
  HlsKeyInfo
} from '@shared/types';

/**
 * M3U8 (HLS) プレイリストの簡易パーサ。
 * 元: Niconicome-develop の M3U8Parser.cs / M3U8Handler.cs / PlaylistNode.cs
 *
 * HLS仕様の全タグはカバーしない (DMSが使う最低限のサブセットのみ):
 *  - #EXTM3U          (ヘッダー)
 *  - #EXT-X-VERSION   (無視)
 *  - #EXT-X-STREAM-INF: BANDWIDTH=, RESOLUTION=, AUDIO=
 *  - #EXT-X-MEDIA:    TYPE=AUDIO, GROUP-ID=, URI=
 *  - #EXT-X-TARGETDURATION
 *  - #EXT-X-KEY:      METHOD=AES-128, URI=, IV=
 *  - #EXT-X-MAP:      URI=  (init segment)
 *  - #EXTINF:         duration
 *  - #EXT-X-ENDLIST
 */
export interface MasterPlaylist {
  streams: HlsStreamInfo[];
  audios: HlsAudioInfo[];
}

export interface VariantPlaylist {
  /** init segment URL (絶対URL) */
  mapUrl: string | null;
  /** init segment filename */
  mapFilename: string | null;
  /** AES-128 key info */
  key: HlsKeyInfo | null;
  /** セグメント */
  segments: HlsSegment[];
  /** target duration */
  targetDuration: number;
}

export class M3U8Parser {
  /**
   * マスタープレイリストをパース。
   * @param baseUrl このm3u8のURL (相対URLの解決に必要)
   */
  static parseMaster(m3u8Text: string, baseUrl: string): MasterPlaylist {
    const lines = m3u8Text.split(/\r?\n/);
    const streams: HlsStreamInfo[] = [];
    const audios: HlsAudioInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = this.parseAttrs(line.substring('#EXT-X-STREAM-INF:'.length));
        const next = (lines[i + 1] ?? '').trim();
        if (!next || next.startsWith('#')) continue;
        const resolution = attrs['RESOLUTION'] ?? '';
        const resHeight = this.extractHeight(resolution);
        streams.push({
          resolution: resHeight,
          bandwidth: Number(attrs['BANDWIDTH'] ?? 0),
          url: this.resolveUrl(baseUrl, next),
          audioGroupId: attrs['AUDIO']
        });
        i++;
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = this.parseAttrs(line.substring('#EXT-X-MEDIA:'.length));
        if ((attrs['TYPE'] ?? '').toUpperCase() !== 'AUDIO') continue;
        if (!attrs['URI']) continue;
        audios.push({
          groupId: attrs['GROUP-ID'] ?? '',
          language: attrs['LANGUAGE'],
          name: attrs['NAME'],
          url: this.resolveUrl(baseUrl, attrs['URI'])
        });
      }
    }
    return { streams, audios };
  }

  /**
   * バリアントプレイリスト (映像 or 音声) をパース。
   */
  static parseVariant(m3u8Text: string, baseUrl: string): VariantPlaylist {
    const lines = m3u8Text.split(/\r?\n/);
    let mapUrl: string | null = null;
    let mapFilename: string | null = null;
    let key: HlsKeyInfo | null = null;
    let targetDuration = 0;
    const segments: HlsSegment[] = [];
    let pendingDuration = 0;
    let index = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = Number(
          line.substring('#EXT-X-TARGETDURATION:'.length).trim()
        );
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = this.parseAttrs(line.substring('#EXT-X-MAP:'.length));
        if (attrs['URI']) {
          mapUrl = this.resolveUrl(baseUrl, attrs['URI']);
          mapFilename = this.extractFilename(attrs['URI']);
        }
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = this.parseAttrs(line.substring('#EXT-X-KEY:'.length));
        if ((attrs['METHOD'] ?? '').toUpperCase() === 'AES-128' && attrs['URI']) {
          key = {
            url: this.resolveUrl(baseUrl, attrs['URI']),
            iv: attrs['IV'] ?? ''
          };
        }
      } else if (line.startsWith('#EXTINF:')) {
        const v = line.substring('#EXTINF:'.length).split(',')[0].trim();
        pendingDuration = Number(v) || 0;
      } else if (!line.startsWith('#')) {
        // セグメントURL行
        segments.push({
          index: index++,
          filename: this.extractFilename(line),
          url: this.resolveUrl(baseUrl, line),
          duration: pendingDuration
        });
        pendingDuration = 0;
      }
    }
    return { mapUrl, mapFilename, key, segments, targetDuration };
  }

  /**
   * `KEY1=VALUE1,KEY2="VALUE 2",...` を辞書化。
   * 引用符内のカンマも考慮する。
   */
  private static parseAttrs(s: string): Record<string, string> {
    const out: Record<string, string> = {};
    let i = 0;
    while (i < s.length) {
      // キーを読む
      const eqIdx = s.indexOf('=', i);
      if (eqIdx < 0) break;
      const key = s.substring(i, eqIdx).trim();
      i = eqIdx + 1;
      // 値を読む (引用符付きの場合は閉じ引用符まで)
      let value: string;
      if (s[i] === '"') {
        const end = s.indexOf('"', i + 1);
        if (end < 0) {
          value = s.substring(i + 1);
          i = s.length;
        } else {
          value = s.substring(i + 1, end);
          i = end + 1;
        }
      } else {
        const commaIdx = s.indexOf(',', i);
        if (commaIdx < 0) {
          value = s.substring(i).trim();
          i = s.length;
        } else {
          value = s.substring(i, commaIdx).trim();
          i = commaIdx;
        }
      }
      out[key] = value;
      // カンマをスキップ
      if (s[i] === ',') i++;
    }
    return out;
  }

  private static resolveUrl(base: string, ref: string): string {
    try {
      return new URL(ref, base).toString();
    } catch {
      return ref;
    }
  }

  private static extractFilename(url: string): string {
    const idx = url.lastIndexOf('/');
    const tail = idx >= 0 ? url.substring(idx + 1) : url;
    return tail.split('?')[0];
  }

  private static extractHeight(resolution: string): number {
    const m = resolution.match(/\d+x(\d+)/);
    return m ? Number(m[1]) : 0;
  }
}
