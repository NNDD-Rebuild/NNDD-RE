import fs from 'node:fs';
import path from 'node:path';
import type { NNDDREComment, WatchPageInfo } from '@shared/types';
import { VideoFileSuffix } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';

const log = createLogger('LocalFile');

/**
 * ローカルファイル名生成ヘルパー。
 *
 * NNDD 互換: `タイトル - [sm12345].mp4` 形式。
 */
export class LocalFileNaming {
  /**
   * ファイル名として使えない文字をエスケープ。
   */
  static sanitize(name: string): string {
    return name
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * "{タイトル} - [{videoId}]" のベース名を作る (NNDD 互換)。
   */
  static baseName(title: string, videoId: string): string {
    const cleanTitle = this.sanitize(title) || videoId;
    return `${cleanTitle} - [${videoId}]`;
  }

  /**
   * 動画本体のファイル名 (拡張子付き)
   */
  static videoFileName(
    title: string,
    videoId: string,
    ext = 'mp4'
  ): string {
    return `${this.baseName(title, videoId)}.${ext}`;
  }

  /** コメントXML */
  static commentXmlFileName(title: string, videoId: string): string {
    return `${this.baseName(title, videoId)}${VideoFileSuffix.COMMENT_XML}`;
  }

  /** 投コメ */
  static ownerCommentXmlFileName(title: string, videoId: string): string {
    return `${this.baseName(title, videoId)}${VideoFileSuffix.OWNER_COMMENT_XML}`;
  }

  /** サムネ画像 */
  static thumbImageFileName(title: string, videoId: string): string {
    return `${this.baseName(title, videoId)}${VideoFileSuffix.THUMB_IMAGE}`;
  }

  /** サムネ情報XML (NNDD 互換 `[ThumbInfo].xml`) */
  static thumbInfoXmlFileName(title: string, videoId: string): string {
    return `${this.baseName(title, videoId)}${VideoFileSuffix.THUMB_INFO_XML}`;
  }

  /** 今コメント no 配列 JSON */
  static nowCommentJsonFileName(title: string, videoId: string): string {
    return `${this.baseName(title, videoId)}${VideoFileSuffix.NOW_COMMENT_JSON}`;
  }


}

/**
 * 付帯ファイル (コメント / サムネ / 動画情報) の保存。
 *
 * 元: NNDD V4 の保存形式を再現するため、互換XMLを書き出す。
 */
export class LocalFileHandler {
  /**
   * コメント一覧を旧仕様 (V2 packet/chat) のXMLに書き出す。
   *
   * 形式:
   * <packet>
   *   <thread thread="..." last_res="N" />
   *   <chat thread="..." no="..." vpos="..." date="..." mail="..." user_id="..." premium="0|1">本文</chat>
   *   ...
   * </packet>
   *
   * vpos は元の単位 (1/100秒) に戻して書く。
   */
  static writeCommentXml(
    filePath: string,
    comments: NNDDREComment[],
    threadId: string,
    videoId?: string,
    fork?: string
  ): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="utf-8"?>');
    if (videoId) {
      lines.push(`<!--BoonSutazioData=${videoId}-->`);
    }
    lines.push('<packet>');

    // <thread> 要素 (本家 NNDD 互換)
    const serverTime = Math.floor(Date.now() / 1000);
    const forkNum = fork === 'owner' ? 1 : fork === 'easy' ? 2 : null;
    const lastRes = comments.length > 0 ? Math.max(...comments.map((c) => c.no)) : 0;
    if (forkNum === null) {
      // 通常コメント: last_res あり、fork なし
      lines.push(
        `  <thread resultcode="0" thread="${threadId}" last_res="${lastRes}" ticket="0" revision="1" server_time="${serverTime}"/>`
      );
      lines.push(`  <leaf thread="${threadId}" count="${comments.length}"/>`);
    } else {
      // 投コメ/easyコメ: fork あり、last_res なし
      lines.push(
        `  <thread resultcode="0" thread="${threadId}" ticket="0" revision="1" fork="${forkNum}" server_time="${serverTime}"/>`
      );
      lines.push('  <ngups/>');
    }

    // 属性順序: thread, fork, no, vpos, date, date_usec, user_id, mail, score, anonymity
    // (Niconicome / 旧 NNDD V4 互換)
    for (const c of comments) {
      const vpos = Math.floor(c.vposMs / 10); // ms → 1/100秒
      const attrs = [
        `thread="${this.xmlAttr(c.thread)}"`,
        c.fork ? `fork="${this.xmlAttr(c.fork)}"` : null,
        `no="${c.no}"`,
        `vpos="${vpos}"`,
        `date="${c.date}"`,
        `date_usec="0"`,
        `user_id="${this.xmlAttr(c.userId)}"`,
        `mail="${this.xmlAttr(c.mail)}"`,
        c.score !== undefined ? `score="${c.score}"` : null,
        `anonymity="${c.isAnonymity ? 1 : 0}"`,
        c.nicoruCount !== undefined ? `nicoru="${c.nicoruCount}"` : null,
        c.isPremium ? 'premium="1"' : null
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`  <chat ${attrs}>${this.xmlBody(c.text)}</chat>`);
    }
    lines.push('</packet>');
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  /**
   * サムネ情報XMLを書く (旧 getthumbinfo 互換)。
   */
  static writeThumbInfoXml(filePath: string, watch: WatchPageInfo): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const e = (s: string): string => this.xmlBody(s);
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<nicovideo_thumb_response status="ok">');
    lines.push('  <thumb>');
    lines.push(`    <video_id>${e(watch.videoId)}</video_id>`);
    lines.push(`    <title>${e(watch.title)}</title>`);
    lines.push(`    <description>${e(watch.description)}</description>`);
    lines.push(`    <thumbnail_url>${e(watch.thumbnail.largeUrl || watch.thumbnail.url)}</thumbnail_url>`);
    lines.push(`    <first_retrieve>${e(watch.registeredAt)}</first_retrieve>`);
    lines.push(`    <length>${this.formatLength(watch.duration)}</length>`);
    lines.push(`    <view_counter>${watch.count.view}</view_counter>`);
    lines.push(`    <comment_num>${watch.count.comment}</comment_num>`);
    lines.push(`    <mylist_counter>${watch.count.mylist}</mylist_counter>`);
    lines.push('    <tags domain="jp">');
    for (const t of watch.tags) {
      lines.push(`      <tag>${e(t)}</tag>`);
    }
    lines.push('    </tags>');
    if (watch.owner) {
      lines.push(`    <user_id>${watch.owner.id}</user_id>`);
      lines.push(`    <user_nickname>${e(watch.owner.nickname)}</user_nickname>`);
      lines.push(`    <user_icon_url>${e(watch.owner.iconUrl)}</user_icon_url>`);
    }
    if (watch.channel) {
      lines.push(`    <ch_id>${e(watch.channel.id)}</ch_id>`);
      lines.push(`    <ch_name>${e(watch.channel.name)}</ch_name>`);
    }
    lines.push('  </thumb>');
    lines.push('</nicovideo_thumb_response>');
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  /**
   * 今コメント no 配列を JSON で保存 (再生時に今コメ/過去コメを切り分けるため)。
   */
  static writeNowCommentJson(filePath: string, nos: number[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(nos), 'utf-8');
  }

  /**
   * サムネ画像をダウンロードして保存。
   */
  static async downloadThumbnail(
    url: string,
    filePath: string
  ): Promise<void> {
    if (!url) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      const buf = await NicoContext.get().http.getBinary(url, {
        noCookieReceive: true
      });
      fs.writeFileSync(filePath, buf);
    } catch (e) {
      log.warn('thumbnail download failed:', url, e);
    }
  }

  /**
   * XML 1.0 で許可されていない制御文字を除去。
   * ニコニコAPIのコメントに稀に含まれる \x00-\x08, \x0B, \x0C, \x0E-\x1F 等を除去する。
   * 参照: https://www.w3.org/TR/xml/#charsets
   */
  // eslint-disable-next-line no-control-regex
  private static readonly INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

  private static xmlAttr(s: string): string {
    return String(s ?? '')
      .replace(this.INVALID_XML_CHARS, '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static xmlBody(s: string): string {
    return String(s ?? '')
      .replace(this.INVALID_XML_CHARS, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static formatLength(durationSec: number): string {
    const m = Math.floor(durationSec / 60);
    const s = Math.floor(durationSec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
