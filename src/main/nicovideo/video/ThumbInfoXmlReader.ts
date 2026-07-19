import fs from 'node:fs';
import type { WatchPageInfo } from '@shared/types';
import { createLogger } from '../../util/Logger';

const log = createLogger('ThumbInfoXmlReader');

export interface ParsedThumbInfo {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  registeredAt: string;
  length: number; // 秒
  thumbnailUrl: string;
  viewCount: number;
  commentCount: number;
  mylistCount: number;
  ownerId: string;
  ownerNickname: string;
  ownerIconUrl: string;
  chId: string;
  chName: string;
}

/**
 * NNDD 互換の `[ThumbInfo].xml` をパースする。
 *
 * 形式: nicovideo_thumb_response / thumb 形式
 * (旧 getthumbinfo API レスポンス互換)
 */
export class ThumbInfoXmlReader {
  static parse(xml: string): ParsedThumbInfo | null {
    try {
      // 簡易XMLパース (正規表現ベース)
      // `\b` 単語境界で <tags> 等の prefix 一致を防ぐ
      const get = (tag: string): string => {
        const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? m[1].trim()
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"') : '';
      };
      const getAll = (tag: string): string[] => {
        const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
        const results: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          results.push(m[1].trim()
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"'));
        }
        return results;
      };

      const videoId = get('video_id');
      if (!videoId) return null;

      return {
        videoId,
        title: get('title'),
        description: get('description'),
        tags: getAll('tag'),
        registeredAt: get('first_retrieve'),
        length: this.parseLengthStr(get('length')),
        thumbnailUrl: get('thumbnail_url'),
        viewCount: Number(get('view_counter')) || 0,
        commentCount: Number(get('comment_num')) || 0,
        mylistCount: Number(get('mylist_counter')) || 0,
        ownerId: get('user_id') || get('ch_id'),
        ownerNickname: get('user_nickname') || get('ch_name'),
        ownerIconUrl: get('user_icon_url'),
        chId: get('ch_id'),
        chName: get('ch_name')
      };
    } catch (e) {
      log.warn('ThumbInfoXmlReader.parse failed:', e);
      return null;
    }
  }

  static parseFile(filePath: string): ParsedThumbInfo | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      return this.parse(text);
    } catch (e) {
      log.warn('parseFile failed:', filePath, e);
      return null;
    }
  }

  /** ローカルファイルから WatchPageInfo (簡易版) を組み立てる */
  static toWatchPageInfo(parsed: ParsedThumbInfo, thumbImagePath = ''): WatchPageInfo {
    const imgPath = thumbImagePath || parsed.thumbnailUrl;
    return {
      videoId: parsed.videoId,
      title: parsed.title,
      description: parsed.description,
      duration: parsed.length,
      tags: parsed.tags,
      thumbnail: {
        url: imgPath,
        largeUrl: imgPath
      },
      count: {
        view: parsed.viewCount,
        comment: parsed.commentCount,
        mylist: parsed.mylistCount,
        like: 0
      },
      registeredAt: parsed.registeredAt,
      owner: parsed.ownerId && !parsed.chId
        ? { id: Number(parsed.ownerId) || 0, nickname: parsed.ownerNickname, iconUrl: parsed.ownerIconUrl }
        : null,
      channel: parsed.chId
        ? { id: parsed.chId, name: parsed.chName, isOfficialAnime: false }
        : null,
      isDMS: false,
      isDownloadable: false,
      isEncrypted: false,
      isEconomy: false,
      commentThreads: [],
      userKey: '',
      threadKey: null,
      dmcResponseJsonData: null,
      contentUrl: null,
      sessionId: null,
      commentServerUrl: '',
      domandAccessRightKey: null,
      domandVideos: [],
      domandAudios: [],
      dmcSessionRequestJson: null,
      nvCommentParams: null,
      series: null,
      actionTrackId: null,
      guestFetched: false,
    };
  }

  /** "MM:SS" または "H:MM:SS" → 秒 */
  private static parseLengthStr(s: string): number {
    if (!s) return 0;
    const parts = s.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return Number(s) || 0;
  }
}
