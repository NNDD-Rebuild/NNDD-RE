import fs from 'node:fs';
import type { WatchPageInfo } from '@shared/types';
import { createLogger } from '../../util/Logger';

const log = createLogger('InfoTxtReader');

export interface ParsedInfoTxt {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  registeredAt: string;
  length: number;
  viewCount: number;
  commentCount: number;
  mylistCount: number;
  ownerId: number | null;
  ownerNickname: string;
  chId: string;
  chName: string;
}

/**
 * Niconicome 互換の `[info].txt` をパースする。
 *
 * 形式 (key と value が空行区切り):
 *   [name]
 *   sm8582212
 *
 *   [title]
 *   ...
 */
export class InfoTxtReader {
  static parse(text: string): ParsedInfoTxt {
    const sections = new Map<string, string>();
    // BOM (UTF-8 ﻿) を除去
    const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    let currentKey: string | null = null;
    let buffer: string[] = [];
    const flush = (): void => {
      if (currentKey !== null) {
        sections.set(currentKey, buffer.join('\n').trim());
      }
      buffer = [];
    };
    for (const line of lines) {
      const m = line.match(/^\[([a-zA-Z_]+)\]\s*$/);
      if (m) {
        flush();
        currentKey = m[1];
        continue;
      }
      if (currentKey !== null) {
        buffer.push(line);
      }
    }
    flush();

    const get = (k: string): string => sections.get(k) ?? '';
    const num = (s: string): number => {
      const n = Number(s.replace(/[, ]/g, ''));
      return isNaN(n) ? 0 : n;
    };
    const lengthFromJp = (s: string): number => {
      const m = s.match(/^(\d+)分(\d+)秒$/);
      if (m) return Number(m[1]) * 60 + Number(m[2]);
      const c = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
      if (c) {
        return c[3]
          ? Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3])
          : Number(c[1]) * 60 + Number(c[2]);
      }
      return num(s);
    };
    const dateFromJp = (s: string): string => {
      // "2009/10/22 08:23:49" → "2009-10-22T08:23:49+09:00"
      const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return s;
      return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`;
    };

    const tagsRaw = get('tags');
    const tags = tagsRaw ? tagsRaw.split('\n').map((t) => t.trim()).filter(Boolean) : [];

    return {
      videoId: get('name'),
      title: get('title'),
      description: get('comment'),
      tags,
      registeredAt: dateFromJp(get('post')),
      length: lengthFromJp(get('length')),
      viewCount: num(get('view_counter')),
      commentCount: num(get('comment_num')),
      mylistCount: num(get('mylist_counter')),
      ownerId: get('owner_id') ? num(get('owner_id')) : null,
      ownerNickname: get('owner_nickname'),
      chId: get('ch_id'),
      chName: get('ch_name')
    };
  }

  static parseFile(filePath: string): ParsedInfoTxt | null {
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
  static toWatchPageInfo(parsed: ParsedInfoTxt, thumbImagePath = ''): WatchPageInfo {
    return {
      videoId: parsed.videoId,
      title: parsed.title,
      description: parsed.description,
      duration: parsed.length,
      tags: parsed.tags,
      thumbnail: {
        url: thumbImagePath,
        largeUrl: thumbImagePath
      },
      count: {
        view: parsed.viewCount,
        comment: parsed.commentCount,
        mylist: parsed.mylistCount,
        like: 0
      },
      registeredAt: parsed.registeredAt,
      owner: parsed.ownerId
        ? { id: parsed.ownerId, nickname: parsed.ownerNickname, iconUrl: '' }
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
    };
  }
}
