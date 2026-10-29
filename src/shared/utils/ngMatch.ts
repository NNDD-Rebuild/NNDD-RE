import { NgListItemType, type NgListItem, type NgListItemTypeValue } from '../types';

export type NgStrength = 'weak' | 'medium' | 'strong';

export interface CompiledNg {
  type: NgListItemTypeValue;
  /** WORD / WORD_EXACT / COMMAND は正規化済み、USER_ID は原文 */
  value: string;
}

export interface NgTarget {
  text: string;
  mail: string;
  userId: string;
  /** 投稿者コメントなら 'owner' (ストリーミング) / '1' (ローカルXML)。許可IDのみ表示でも常に表示する */
  fork?: string;
}

/**
 * NG ワード照合用の正規化。全角/半角 (英数・記号・半角カナ)・大文字小文字・
 * ひらがな/カタカナの違いを吸収する。
 */
export function normalizeNgText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** NG リストを照合用に正規化する。リスト変更時に1回だけ呼び、結果を使い回す */
export function compileNgList(ngList: readonly NgListItem[]): CompiledNg[] {
  const out: CompiledNg[] = [];
  for (const ng of ngList) {
    const value =
      ng.type === NgListItemType.USER_ID || ng.type === NgListItemType.PERMIT_ID
        ? ng.value : normalizeNgText(ng.value);
    if (value === '') continue; // 空文字は includes が常に真になり全コメントが消える
    out.push({ type: ng.type, value });
  }
  return out;
}

/**
 * コメントが NG にマッチするか。permitOnly が真なら、許可ID以外のコメントを NG とみなす。弱 (weak) では部分一致の NG ワードも完全一致のときだけ適用する。
 */
export function matchesNg(
  target: NgTarget,
  compiled: readonly CompiledNg[],
  strength: NgStrength = 'medium',
  permitOnly = false
): boolean {
  if (permitOnly) {
    // 許可IDのみ表示: 許可IDのユーザーと投稿者のコメントだけを残す (通常のNG判定は行わない)
    if (target.fork === 'owner' || target.fork === '1') return false;
    return !compiled.some((ng) => ng.type === NgListItemType.PERMIT_ID && ng.value === target.userId);
  }
  if (compiled.length === 0) return false;
  let text: string | null = null;
  let mail: string | null = null;
  for (const ng of compiled) {
    switch (ng.type) {
      case NgListItemType.USER_ID:
        if (target.userId === ng.value) return true;
        break;
      case NgListItemType.WORD:
        text ??= normalizeNgText(target.text);
        if (strength === 'weak' ? text === ng.value : text.includes(ng.value)) return true;
        break;
      case NgListItemType.WORD_EXACT:
        text ??= normalizeNgText(target.text);
        if (text === ng.value) return true;
        break;
      case NgListItemType.COMMAND:
        mail ??= normalizeNgText(target.mail);
        if (mail.includes(ng.value)) return true;
        break;
    }
  }
  return false;
}

const SPAM_WINDOW_MS = 10_000;
const SPAM_THRESHOLD = 5;

/**
 * strong モード用: 同一ユーザーが SPAM_WINDOW_MS 以内に SPAM_THRESHOLD 件以上
 * 投稿している場合、そのユーザーの全コメントを連投スパムとして扱う。
 */
export function detectSpamUsers(comments: readonly { userId: string; vposMs: number }[]): Set<string> {
  const byUser = new Map<string, number[]>();
  for (const c of comments) {
    let arr = byUser.get(c.userId);
    if (!arr) {
      arr = [];
      byUser.set(c.userId, arr);
    }
    arr.push(c.vposMs);
  }
  const spam = new Set<string>();
  for (const [userId, times] of byUser) {
    if (times.length < SPAM_THRESHOLD) continue;
    times.sort((x, y) => x - y);
    for (let i = 0; i + SPAM_THRESHOLD - 1 < times.length; i++) {
      if (times[i + SPAM_THRESHOLD - 1] - times[i] <= SPAM_WINDOW_MS) {
        spam.add(userId);
        break;
      }
    }
  }
  return spam;
}
