import { IpcChannel } from '@shared/types';
import { NicoApi } from '@shared/constants';

/** 説明文 (sanitizeDescription 済み) のクリック位置からリンク URL を取り出す */
export function descriptionLinkUrl(e: React.MouseEvent<HTMLElement>): string | null {
  const target = e.target as HTMLElement;
  return target.dataset.url || target.closest('[data-url]')?.getAttribute('data-url') || null;
}

/**
 * 説明文中のリンクを開く。マイリスト・シリーズはアプリ内のタブ、
 * 動画は設定 player.openVideoLinkInPlayer が ON ならプレイヤー、それ以外は外部ブラウザで開く
 */
export function openDescriptionUrl(url: string, openVideoLinkInPlayer: boolean): void {
  const mylistMatch =
    url.match(/nicovideo\.jp\/my\/mylist\/(\d+)/) ??
    url.match(/nicovideo\.jp\/mylist\/(\d+)/);
  const seriesMatch = url.match(/nicovideo\.jp\/series\/(\d+)/);
  const videoMatch = openVideoLinkInPlayer
    ? url.match(/nicovideo\.jp\/watch\/((?:sm|nm|so|ss)\d+)/)
    : null;
  if (mylistMatch) {
    window.nndd.invoke(IpcChannel.NAV_MYLIST, mylistMatch[1]);
  } else if (seriesMatch) {
    window.nndd.invoke(IpcChannel.NAV_SERIES, seriesMatch[1]);
  } else if (videoMatch) {
    window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId: videoMatch[1] });
  } else {
    window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, url);
  }
}

const LINK_CLASS = 'style="color:#e94e1b;text-decoration:underline;cursor:pointer;pointer-events:auto"';

export function sanitizeDescription(html: string): string {
  // 1. 危険タグ除去
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '');

  // 2. <a href="https://..."> → <a data-url="..."> (デフォルトナビゲーション無効化)
  s = s.replace(
    /<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi,
    (_m, pre, url, post) =>
      `<a ${pre}data-url="${url}" ${post} ${LINK_CLASS}>`
  );

  // 3. 既存の <a>...</a> をプレースホルダーに退避
  //    → アンカー内部で sm/mylist を二重リンク化しないため
  const anchors: string[] = [];
  s = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    anchors.push(match);
    return `\x00A${anchors.length - 1}\x00`;
  });

  // 4. プレーンテキストの https:// URL をリンク化 (ASCII文字のみ)
  s = s.replace(
    /(?<![="])((https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+))/g,
    `<a data-url="$1" ${LINK_CLASS}>$1</a>`
  );

  // 5. sm/nm/so/ss で始まる動画 ID をリンク化
  s = s.replace(
    /\b((?:sm|nm|so|ss)\d+)\b/g,
    `<a data-url="${NicoApi.WATCH_PAGE}$1" ${LINK_CLASS}>$1</a>`
  );

  // 6. mylist/数字 をマイリストリンクに変換
  s = s.replace(
    /\b(mylist\/(\d+))\b/g,
    `<a data-url="${NicoApi.MYLIST_PAGE}$2" ${LINK_CLASS}>$1</a>`
  );

  // 7. プレースホルダーを元のアンカーに戻す
  s = s.replace(/\x00A(\d+)\x00/g, (_, i) => anchors[Number(i)]);

  return s;
}
