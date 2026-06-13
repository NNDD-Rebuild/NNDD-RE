import type {
  WatchPageInfo,
  CommentThreadInfo,
  DomandStreamCandidate
} from '@shared/types';
import { createLogger } from '../../util/Logger';

const log = createLogger('WatchPageParser');

/**
 * 新仕様のニコニコ動画ウォッチページから埋め込みJSONを抽出する。
 *
 * 現代のニコニコ動画ページ (2023年以降) は、
 *  <meta name="server-response" content='{...}'>
 *  または
 *  <div id="js-initial-watch-data" data-api-data="{...}">
 * のいずれかに、ウォッチ用JSONを埋め込んでいる。
 *
 * Niconicome の WatchPageInfomationHandler.cs と同等の処理を行う。
 */
export class WatchPageParser {
  /**
   * HTML文字列を受け取り、watch JSONをパースして返す。
   * @throws JSONが見つからない場合
   */
  static parse(html: string, videoId: string): WatchPageInfo {
    const json = this.extractEmbeddedJson(html);
    if (!json) {
      throw new Error('watch JSON not found in page');
    }
    const root =
      (json as Record<string, unknown>)['data'] ??
      (json as Record<string, unknown>)['response'] ??
      json;
    return this.parseRoot(root as Record<string, unknown>, videoId);
  }

  /**
   * /api/watch/v3 の JSON API レスポンスの data オブジェクトを受け取ってパース。
   * HTML の埋め込み JSON と同じ構造なので parse() と同じ処理を流用する。
   */
  static parseApiData(data: unknown, videoId: string): WatchPageInfo {
    const root =
      (data as Record<string, unknown>)['data'] ??
      (data as Record<string, unknown>)['response'] ??
      data;
    return this.parseRoot(root as Record<string, unknown>, videoId);
  }

  private static parseRoot(data: Record<string, unknown>, videoId: string): WatchPageInfo {
    const videoNode = (data['video'] ?? {}) as Record<string, unknown>;
    const ownerNode = (data['owner'] ?? null) as Record<string, unknown> | null;
    const channelNode = (data['channel'] ?? null) as Record<string, unknown> | null;
    const seriesNode = (data['series'] ?? null) as Record<string, unknown> | null;
    const mediaNode = (data['media'] ?? {}) as Record<string, unknown>;
    const commentNode = (data['comment'] ?? {}) as Record<string, unknown>;
    const tagNode = (data['tag'] ?? {}) as Record<string, unknown>;
    const clientNode = (data['client'] ?? {}) as Record<string, unknown>;

    const thumbnailNode = (videoNode['thumbnail'] ?? {}) as Record<string, unknown>;
    const countNode = (videoNode['count'] ?? {}) as Record<string, unknown>;

    const isDMS = this.detectIsDMS(mediaNode);
    const domandInfo = this.parseDomand(mediaNode);
    const dmcSessionJson = this.extractDmcSessionJson(mediaNode);

    const commentThreads = this.parseCommentThreads(commentNode);
    const threadKey = this.findThreadKey(commentNode);
    const userKey = this.findUserKey(commentNode);
    const nvCommentParams = this.findNvCommentParams(commentNode);

    const tags = ((tagNode['items'] ?? []) as Array<Record<string, unknown>>)
      .map((t) => String(t['name'] ?? ''))
      .filter(Boolean);

    return {
      videoId: String(videoNode['id'] ?? videoId),
      title: String(videoNode['title'] ?? ''),
      description: String(videoNode['description'] ?? ''),
      duration: Number(videoNode['duration'] ?? 0),
      tags,
      thumbnail: {
        url: String(thumbnailNode['url'] ?? ''),
        largeUrl: String(
          thumbnailNode['largeUrl'] ?? thumbnailNode['middleUrl'] ?? ''
        )
      },
      count: {
        view: Number(countNode['view'] ?? 0),
        comment: Number(countNode['comment'] ?? 0),
        mylist: Number(countNode['mylist'] ?? 0),
        like: Number(countNode['like'] ?? 0)
      },
      registeredAt: String(videoNode['registeredAt'] ?? ''),
      owner: ownerNode
        ? {
            id: Number(ownerNode['id'] ?? 0),
            nickname: String(ownerNode['nickname'] ?? ''),
            iconUrl: String(ownerNode['iconUrl'] ?? '')
          }
        : null,
      channel: channelNode
        ? {
            id: String(channelNode['id'] ?? ''),
            name: String(channelNode['name'] ?? ''),
            isOfficialAnime: Boolean(channelNode['isOfficialAnime'])
          }
        : null,
      isDMS,
      isDownloadable: !Boolean(videoNode['isDeleted']) &&
        (domandInfo.accessRightKey !== null || dmcSessionJson !== null),
      isEncrypted: this.detectIsEncrypted(mediaNode),
      isEconomy: false,
      commentThreads,
      userKey,
      threadKey,
      dmcResponseJsonData: null,
      contentUrl: null,
      sessionId: null,
      commentServerUrl: this.findCommentServerUrl(commentNode, clientNode),
      domandAccessRightKey: domandInfo.accessRightKey,
      domandVideos: domandInfo.videos,
      domandAudios: domandInfo.audios,
      dmcSessionRequestJson: dmcSessionJson,
      nvCommentParams,
      series: seriesNode && seriesNode['id']
        ? { id: String(seriesNode['id']), title: String(seriesNode['title'] ?? '') }
        : null,
    };
  }

  /**
   * HTMLからシリーズ情報だけを抽出する。
   * v3 APIが series:null を返した場合のフォールバック用。
   * まず埋め込みJSONを試み、次にHTMLの生テキストから正規表現で抽出する。
   * @returns `{ id: string; title: string }` または `null`
   */
  static parseSeriesFromHtml(html: string): { id: string; title: string } | null {
    // 1) 埋め込みJSON経由
    const json = this.extractEmbeddedJson(html);
    if (json) {
      // HTML埋め込みJSONは { data: { series: ... } } か { response: { series: ... } } の形式
      const root =
        (json as Record<string, unknown>)['data'] ??
        (json as Record<string, unknown>)['response'] ??
        json;
      const seriesNode = (root as Record<string, unknown>)['series'] ?? null;
      if (seriesNode && typeof seriesNode === 'object') {
        const s = seriesNode as Record<string, unknown>;
        if (s['id']) {
          return { id: String(s['id']), title: String(s['title'] ?? '') };
        }
      }
    }

    // 2) meta content はエンティティエンコード済みのため、デコード後に正規表現を実行
    const decodedHtml = this.htmlDecode(html);
    const seriesJsonMatch = decodedHtml.match(/"series"\s*:\s*\{\s*"id"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (seriesJsonMatch) {
      log.debug('parseSeriesFromHtml: series found via decoded JSON regex');
      let seriesTitle = seriesJsonMatch[2];
      try { seriesTitle = JSON.parse('"' + seriesTitle + '"'); } catch { /* keep raw */ }
      return { id: seriesJsonMatch[1], title: seriesTitle };
    }

    // 3) HTML内の href="/series/数字" パターンからIDだけ取得 (タイトルは別途取得が必要)
    const seriesHrefMatch = html.match(/href=["'](?:https?:\/\/www\.nicovideo\.jp)?\/(?:user\/\d+\/)?series\/(\d+)["']/);
    if (seriesHrefMatch) {
      log.debug('parseSeriesFromHtml: series id found via href regex, id=%s (title unknown)', seriesHrefMatch[1]);
      // タイトル不明のまま ID のみ返す (呼び出し元が別途タイトルを補完する)
      return { id: seriesHrefMatch[1], title: '' };
    }

    return null;
  }

  /**
   * HTMLからシリーズIDだけを抽出する (href パターン)。
   * タイトルは含まない。WatchInfoHandler が別途 nvapi で補完する用途。
   */
  static parseSeriesIdFromHtmlHref(html: string): string | null {
    const m = html.match(/href=["'](?:https?:\/\/www\.nicovideo\.jp)?\/(?:user\/\d+\/)?series\/(\d+)["']/);
    return m ? m[1] : null;
  }

  /**
   * 旧 (meta server-response) と新 (data-api-data) の両方を試みる。
   * meta タグの属性順序 (name/content どちらが先でも) に対応。
   */
  private static extractEmbeddedJson(html: string): unknown | null {
    // meta name="server-response" content='...'
    // 属性順序不問: name が先でも content が先でも対応
    const metaBlockMatch = html.match(/<meta\b[^>]*\bname=["']server-response["'][^>]*>/i);
    if (metaBlockMatch) {
      const metaTag = metaBlockMatch[0];
      const contentMatch = metaTag.match(/\bcontent=(["'])([\s\S]*?)\1/i);
      if (contentMatch) {
        try {
          const decoded = this.htmlDecode(contentMatch[2]);
          return JSON.parse(decoded);
        } catch (e) {
          log.warn('meta server-response parse failed:', e);
        }
      }
    }

    // div id="js-initial-watch-data" data-api-data='...'
    const divMatch = html.match(
      /data-api-data=(["'])([\s\S]*?)\1/i
    );
    if (divMatch) {
      try {
        const decoded = this.htmlDecode(divMatch[2]);
        return JSON.parse(decoded);
      } catch (e) {
        log.warn('data-api-data parse failed:', e);
      }
    }

    return null;
  }

  private static htmlDecode(s: string): string {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /**
   * DMSドメイン (新システム) で配信されているかを判定。
   * media.domand が存在する場合は DMS、media.delivery のみは DMC。
   */
  private static detectIsDMS(media: Record<string, unknown>): boolean {
    if (media['domand']) return true;
    // 新仕様の watch JSON で session 系プロパティがないものは DMS の場合あり
    const delivery = (media['delivery'] ?? null) as Record<string, unknown> | null;
    if (!delivery) return true;
    return false;
  }

  private static detectIsEncrypted(media: Record<string, unknown>): boolean {
    const delivery = (media['delivery'] ?? null) as Record<string, unknown> | null;
    if (!delivery) return false;
    return Boolean(delivery['encryption']);
  }

  private static parseCommentThreads(
    comment: Record<string, unknown>
  ): CommentThreadInfo[] {
    // V2 構造: comment.threads (配列)
    const threadsArr = (comment['threads'] ?? []) as Array<
      Record<string, unknown>
    >;
    return threadsArr.map((t) => ({
      id: String(t['id'] ?? ''),
      fork: String(t['fork'] ?? 'main'),
      isActive: Boolean(t['isActive']),
      isDefaultPostTarget: Boolean(t['isDefaultPostTarget']),
      isEasyCommentPostTarget: Boolean(t['isEasyCommentPostTarget']),
      isLeafRequired: Boolean(t['isLeafRequired']),
      isOwnerThread: Boolean(t['isOwnerThread']),
      isThreadkeyRequired: Boolean(t['isThreadkeyRequired']),
      threadkey: t['threadkey'] ? String(t['threadkey']) : null,
      is184Forced: Boolean(t['is184Forced']),
      label: String(t['label'] ?? '')
    }));
  }

  private static findThreadKey(comment: Record<string, unknown>): string | null {
    // 新仕様: nvComment.threadKey
    const nv = comment['nvComment'] as Record<string, unknown> | undefined;
    if (nv?.['threadKey']) return String(nv['threadKey']);
    // V3 トップレベル
    if (comment['threadKey']) return String(comment['threadKey']);
    // V2 スレッド配列
    const threads = (comment['threads'] ?? []) as Array<Record<string, unknown>>;
    for (const t of threads) {
      if (t['threadkey']) return String(t['threadkey']);
    }
    return null;
  }

  private static findNvCommentParams(
    comment: Record<string, unknown>
  ): { targets: Array<{ id: string; fork: string }>; language: string } | null {
    const nv = comment['nvComment'] as Record<string, unknown> | undefined;
    if (!nv) return null;
    const params = nv['params'] as Record<string, unknown> | undefined;
    if (!params) return null;
    const targets = ((params['targets'] ?? []) as Array<Record<string, unknown>>).map(
      (t) => ({ id: String(t['id'] ?? ''), fork: String(t['fork'] ?? 'main') })
    );
    return { targets, language: String(params['language'] ?? 'ja-jp') };
  }

  private static findUserKey(comment: Record<string, unknown>): string {
    const keys = (comment['keys'] ?? {}) as Record<string, unknown>;
    return String(keys['userKey'] ?? '');
  }

  /**
   * media.domand から DMS用情報を抽出。
   *   - accessRightKey: HLSセッション開始時のヘッダー X-Access-Right-Key
   *   - videos[] / audios[]: ストリーム候補
   */
  private static parseDomand(media: Record<string, unknown>): {
    accessRightKey: string | null;
    videos: DomandStreamCandidate[];
    audios: DomandStreamCandidate[];
  } {
    const domand = media['domand'] as Record<string, unknown> | undefined;
    if (!domand) {
      return { accessRightKey: null, videos: [], audios: [] };
    }
    const accessRightKey =
      typeof domand['accessRightKey'] === 'string'
        ? (domand['accessRightKey'] as string)
        : null;
    const videos = ((domand['videos'] ?? []) as Array<Record<string, unknown>>).map(
      this.toStreamCandidate
    );
    const audios = ((domand['audios'] ?? []) as Array<Record<string, unknown>>).map(
      this.toStreamCandidate
    );
    return { accessRightKey, videos, audios };
  }

  private static toStreamCandidate(
    n: Record<string, unknown>
  ): DomandStreamCandidate {
    return {
      id: String(n['id'] ?? ''),
      isAvailable: Boolean(n['isAvailable']),
      qualityLevel: Number(n['qualityLevel'] ?? 0),
      label: n['label'] ? String(n['label']) : undefined,
      bitRate: n['bitRate'] ? Number(n['bitRate']) : undefined,
      width: n['width'] ? Number(n['width']) : undefined,
      height: n['height'] ? Number(n['height']) : undefined
    };
  }

  /**
   * DMC 旧仕様のセッション作成リクエストJSONを抽出。
   * 元の data-api-data には media.delivery.movie.session が含まれる。
   * これを元に DMC API へ POST /api/sessions する JSON テンプレートを作る。
   */
  private static extractDmcSessionJson(
    media: Record<string, unknown>
  ): string | null {
    const delivery = media['delivery'] as Record<string, unknown> | undefined;
    if (!delivery) return null;
    const movie = delivery['movie'] as Record<string, unknown> | undefined;
    if (!movie) return null;
    const session = movie['session'];
    if (!session) return null;
    try {
      return JSON.stringify(session);
    } catch {
      return null;
    }
  }

  private static findCommentServerUrl(
    comment: Record<string, unknown>,
    client: Record<string, unknown>
  ): string {
    // 新仕様で comment.nvComment.server を持つことがある
    const nv = comment['nvComment'] as Record<string, unknown> | undefined;
    if (nv && nv['server']) return String(nv['server']);
    // フォールバック: client.nicosid 付近にあるパターン
    void client;
    return 'https://public.nvcomment.nicovideo.jp';
  }
}
