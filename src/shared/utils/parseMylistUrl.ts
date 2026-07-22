import { RssType, type RssTypeValue } from '../types/mylist';

export interface ParsedMylistSource {
  type: RssTypeValue;
  id: string;
  /** 保存・表示用に正規化したURL */
  normalizedUrl: string;
}

/**
 * ID/URL文字列からマイリスト種別を自動判定する。
 * 元: Niconicome の InputTextParser.cs
 */
export function parseMylistSource(input: string): ParsedMylistSource | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // mylist は user/xxx/mylist/yyy 形式もあるため最優先で判定
  let m = trimmed.match(/mylist\/(\d+)/);
  if (m) {
    return { type: RssType.MY_LIST, id: m[1], normalizedUrl: `https://www.nicovideo.jp/my/mylist/${m[1]}` };
  }

  m = trimmed.match(/series\/(\d+)/);
  if (m) {
    return { type: RssType.SERIES, id: m[1], normalizedUrl: `https://www.nicovideo.jp/series/${m[1]}` };
  }

  m = trimmed.match(/ch\.nicovideo\.jp\/([a-zA-Z0-9_-]+)/);
  if (m) {
    return { type: RssType.CHANNEL, id: m[1], normalizedUrl: `https://ch.nicovideo.jp/${m[1]}` };
  }

  m = trimmed.match(/nicovideo\.jp\/user\/(\d+)/);
  if (m) {
    return { type: RssType.USER_UPLOAD_VIDEO, id: m[1], normalizedUrl: `https://www.nicovideo.jp/user/${m[1]}` };
  }

  // ID単体はマイリストとみなす (従来挙動を踏襲)
  if (/^\d+$/.test(trimmed)) {
    return { type: RssType.MY_LIST, id: trimmed, normalizedUrl: `https://www.nicovideo.jp/my/mylist/${trimmed}` };
  }

  return null;
}

/**
 * 保存済み myListUrl + type から取得用IDを抽出する。
 */
export function extractMylistLikeId(myListUrl: string, type: RssTypeValue): string | null {
  switch (type) {
    case RssType.SERIES:
      return myListUrl.match(/series\/(\d+)/)?.[1] ?? null;
    case RssType.CHANNEL:
      return myListUrl.match(/ch\.nicovideo\.jp\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
    case RssType.USER_UPLOAD_VIDEO:
      return myListUrl.match(/user\/(\d+)/)?.[1] ?? null;
    default:
      return myListUrl.match(/(?:mylist\/|^)(\d+)/)?.[1] ?? null;
  }
}
