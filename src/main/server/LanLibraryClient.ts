import { createLogger } from '../util/Logger';

const log = createLogger('LanLibraryClient');

export interface LanVideo {
  videoId: string;
  filename: string;
  isEconomy: boolean;
}

export interface LanVideoDetail {
  videoId: string;
  videoUrl: string;
  extension: string;
  filename: string;
}

export interface LanMyList {
  id: string;
  rssType: string;
  name: string;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

export class LanLibraryClient {
  private base: string;

  constructor(address: string, port: number) {
    this.base = `http://${address}:${port}`;
  }

  async ping(): Promise<boolean> {
    log.verbose(`LAN ping → ${this.base}/NNDDServer`);
    try {
      const resp = await fetch(`${this.base}/NNDDServer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<nnddRequest type="GET_VIDEO_ID_LIST"/>',
        signal: AbortSignal.timeout(3000)
      });
      log.verbose(`LAN ping ← status ${resp.status}`);
      return resp.status < 500;
    } catch (e) {
      log.warn(`LAN ping failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async getVideoIdList(): Promise<LanVideo[]> {
    try {
      const resp = await fetch(`${this.base}/NNDDServer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<nnddRequest type="GET_VIDEO_ID_LIST"/>',
        signal: AbortSignal.timeout(5000)
      });
      log.verbose(`LAN getVideoIdList ← status ${resp.status}`);
      if (!resp.ok) return [];
      const text = await resp.text();
      log.verbose(`LAN getVideoIdList body(300): ${text.slice(0, 300)}`);
      const results: LanVideo[] = [];
      const re = /<video\s+([^>]+)>([^<]*)<\/video>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const attrs = parseAttrs(m[1]);
        if (attrs['id']) {
          results.push({
            videoId: attrs['id'],
            filename: m[2].trim(),
            isEconomy: attrs['isEconomy'] === 'true'
          });
        }
      }
      return results;
    } catch (e) {
      log.warn('getVideoIdList failed:', e);
      return [];
    }
  }

  async getVideoById(videoId: string): Promise<LanVideoDetail | null> {
    try {
      const body = `<nnddRequest type="GET_VIDEO_BY_ID"><video id="${videoId}"/></nnddRequest>`;
      const resp = await fetch(`${this.base}/NNDDServer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body,
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) return null;
      const text = await resp.text();
      const m = text.match(/<video\s+([^>]+)>([^<]*)<\/video>/);
      if (!m) return null;
      const attrs = parseAttrs(m[1]);
      if (!attrs['id'] || !attrs['videoUrl']) return null;
      return {
        videoId: attrs['id'],
        videoUrl: attrs['videoUrl'],
        extension: attrs['extension'] ?? 'mp4',
        filename: m[2].trim()
      };
    } catch (e) {
      log.warn('getVideoById failed:', videoId, e);
      return null;
    }
  }

  async getMyListList(): Promise<LanMyList[]> {
    try {
      const resp = await fetch(`${this.base}/NNDDServer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<nnddRequest type="GET_MYLIST_LIST"/>',
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      const results: LanMyList[] = [];
      const re = /<rss\s+([^/]+)\/>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const attrs = parseAttrs(m[1]);
        if (attrs['id'] && attrs['name']) {
          results.push({
            id: attrs['id'],
            rssType: attrs['rssType'] ?? 'MY_LIST',
            name: attrs['name']
          });
        }
      }
      return results;
    } catch (e) {
      log.warn('getMyListList failed:', e);
      return [];
    }
  }
}
