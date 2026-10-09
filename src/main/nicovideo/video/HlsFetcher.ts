import { NicoContext } from '../NicoContext';

/**
 * HLS のプレイリスト・鍵・セグメントを取得する手段。
 * 通常の動画DLはニコニコのCookie付きHTTP (NicoContext) をそのまま使う。
 * 生放送は署名Cookie (CloudFront) をパス別に付ける必要があるため、差し替えられるようにしている。
 */
export interface HlsFetcher {
  getText(url: string, signal?: AbortSignal): Promise<string>;
  getBinary(url: string, signal?: AbortSignal): Promise<Buffer>;
}

export const nicoHlsFetcher: HlsFetcher = {
  getText: (url, signal) => NicoContext.get().http.getText(url, { signal }),
  getBinary: (url, signal) => NicoContext.get().http.getBinary(url, { signal })
};
