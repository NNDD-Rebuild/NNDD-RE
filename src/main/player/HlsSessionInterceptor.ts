import type { Session } from 'electron';
import { NicoContext } from '../nicovideo/NicoContext';

const NICO_URL_PATTERNS = [
  'https://*.nicovideo.jp/*',
  'https://*.dmc.nico/*',
  'https://dmc.nico/*',
  'https://nvapi.nicovideo.jp/*',
  'https://*.nimg.jp/*',
];

/**
 * セッションごとの実効 hideWatchHistory 状態。
 * config生値ではなくPlayerManager.open()が計算した実効値 (forceAllowHistory加味後) を保持する。
 * setupHlsSessionInterceptor呼び出しのたびに更新され、既存リスナーもこれを都度参照する。
 */
const sessionState = new WeakMap<Session, { hideHistory: boolean }>();

export function setupHlsSessionInterceptor(ses: Session, hideHistory: boolean): void {
  const existing = sessionState.get(ses);
  if (existing) {
    existing.hideHistory = hideHistory;
    return;
  }
  const state = { hideHistory };
  sessionState.set(ses, state);

  ses.webRequest.onBeforeSendHeaders({ urls: NICO_URL_PATTERNS }, (details, callback) => {
    void (async () => {
      try {
        // hideWatchHistory=ON時は access-rights もゲスト扱いで発行しているため、
        // ここでログイン中Cookieを付けると domand セッションと不整合になり m3u8 が
        // HTTP 400/403 になる。この Player ウィンドウは guest partition (Cookie分離)
        // で開かれているため、素の状態では Cookie は無い。
        // ただし access-rights が発行した domand_bid だけは CDN 視聴に必須なので
        // (registerIpc.ts の injectDomandBidCookie で session.cookies.set 済み)、明示的に
        // ヘッダーへ付与する。hls.js の XHR/fetch は withCredentials を設定していないため、
        // Electron の自動Cookie送信(ブラウザのCORSクレデンシャルポリシー)に任せると送られない。
        const headers = { ...details.requestHeaders };
        if (!state.hideHistory) {
          const cookie = await NicoContext.get().cookieStore.cookieHeader(details.url);
          if (cookie) headers['Cookie'] = cookie;
        } else {
          const sesCookies = await ses.cookies.get({ url: details.url });
          if (sesCookies.length > 0) {
            headers['Cookie'] = sesCookies.map((c) => `${c.name}=${c.value}`).join('; ');
          }
        }
        callback({ requestHeaders: headers });
      } catch {
        callback({ requestHeaders: details.requestHeaders });
      }
    })();
  });

  ses.webRequest.onHeadersReceived({ urls: NICO_URL_PATTERNS }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'access-control-allow-origin': ['*'],
        'access-control-allow-credentials': ['true'],
      },
    });
  });
}

/**
 * 「履歴非表示中は再生できない動画」ダイアログでユーザーが履歴を残す方を選んだ場合、
 * ウィンドウを開き直さずに同一セッションのままCookie扱いだけ切り替える。
 * setupHlsSessionInterceptorで既にリスナー登録済みのセッションに対してのみ効果がある。
 */
export function updateSessionHideHistory(ses: Session, hideHistory: boolean): void {
  const existing = sessionState.get(ses);
  if (existing) existing.hideHistory = hideHistory;
}
