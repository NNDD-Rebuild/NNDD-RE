import type { Session } from 'electron';
import { NicoContext } from '../nicovideo/NicoContext';
import { getConfigStore } from '../config/ConfigStore';

const NICO_URL_PATTERNS = [
  'https://*.nicovideo.jp/*',
  'https://*.dmc.nico/*',
  'https://dmc.nico/*',
  'https://nvapi.nicovideo.jp/*',
  'https://*.nimg.jp/*',
];

const installedSessions = new WeakSet<Session>();

export function setupHlsSessionInterceptor(ses: Session): void {
  if (installedSessions.has(ses)) return;
  installedSessions.add(ses);

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
        const hideHistory = getConfigStore().get('hideWatchHistory') ?? false;
        const headers = { ...details.requestHeaders };
        if (!hideHistory) {
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
