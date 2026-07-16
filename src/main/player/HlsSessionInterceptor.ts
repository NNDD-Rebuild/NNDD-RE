import type { Session } from 'electron';
import { NicoContext } from '../nicovideo/NicoContext';

const NICO_URL_PATTERNS = [
  'https://*.nicovideo.jp/*',
  'https://*.dmc.nico/*',
  'https://dmc.nico/*',
  'https://nvapi.nicovideo.jp/*',
  'https://*.nimg.jp/*',
];

let interceptorInstalled = false;

export function setupHlsSessionInterceptor(ses: Session): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  ses.webRequest.onBeforeSendHeaders({ urls: NICO_URL_PATTERNS }, (details, callback) => {
    void (async () => {
      try {
        const cookie = await NicoContext.get().cookieStore.cookieHeader(details.url);
        const headers = { ...details.requestHeaders };
        if (cookie) headers['Cookie'] = cookie;
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
