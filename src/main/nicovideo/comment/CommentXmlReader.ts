import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import {
  type NNDDREComment,
  CommentPosition,
  CommentSize
} from '@shared/types';
import { CommentCommandParser } from './CommentCommandParser';

/**
 * ローカル保存された旧仕様のコメントXML (packet/chat) を読み込んで NNDDREComment 配列に変換する。
 *
 * 元のNNDDで保存していたXML形式 (および新仕様で書き出した V2 互換XML) を扱う。
 *  <packet>
 *    <thread thread="..." last_res="..." />
 *    <chat thread="..." no="..." vpos="..." date="..." mail="..." user_id="..." premium="0|1"
 *          anonymity="0|1" fork="..." nicoru="..." score="...">本文</chat>
 *    ...
 *  </packet>
 *
 * - `vpos` は 1/100秒 単位の場合があるので ms に変換する。
 */
export class CommentXmlReader {
  static readFile(filePath: string): NNDDREComment[] {
    if (!fs.existsSync(filePath)) return [];
    const xml = fs.readFileSync(filePath, 'utf-8');
    return this.parse(xml);
  }

  static parse(xml: string): NNDDREComment[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      cdataPropName: '__cdata',
      preserveOrder: false,
      trimValues: false
    });
    const doc = parser.parse(xml);
    const packet = doc?.packet;
    if (!packet) return [];
    const chats = packet.chat;
    const chatArr = Array.isArray(chats) ? chats : chats ? [chats] : [];

    const out: NNDDREComment[] = [];
    for (const ch of chatArr) {
      const obj = ch as Record<string, unknown>;
      const text = String(obj['#text'] ?? obj['__cdata'] ?? '');
      const mail = String(obj['@_mail'] ?? '');
      const userId = String(obj['@_user_id'] ?? '');
      const isPremium = String(obj['@_premium'] ?? '') === '1';
      const isAnonymity = String(obj['@_anonymity'] ?? '') === '1';
      const cmd = CommentCommandParser.parse(mail, isPremium);
      const vposRaw = Number(obj['@_vpos'] ?? 0);
      const vposMs = vposRaw * 10; // 1/100秒 → ms

      out.push({
        thread: String(obj['@_thread'] ?? ''),
        no: Number(obj['@_no'] ?? 0),
        vposMs,
        date: Number(obj['@_date'] ?? 0),
        mail,
        userId,
        text,
        isPremium,
        isAnonymity,
        isShow: true,
        sizeCommand: cmd.size ?? CommentSize.MEDIUM,
        positionCommand: cmd.position ?? CommentPosition.NAKA,
        color: cmd.color,
        strokeColor: cmd.strokeColor,
        nicoruCount: obj['@_nicoru'] !== undefined
          ? Number(obj['@_nicoru'])
          : undefined,
        score: obj['@_score'] !== undefined
          ? Number(obj['@_score'])
          : undefined,
        fork: obj['@_fork'] ? String(obj['@_fork']) : undefined
      });
    }
    return out;
  }
}
