import express, { type Express, type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { NNDDREVideo } from '@shared/types';
import { VideoFileSuffix } from '@shared/constants/paths';
import { LibraryManager } from '../db/LibraryManager';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { CommentXmlReader } from '../nicovideo/comment/CommentXmlReader';
import { ThumbInfoXmlReader } from '../nicovideo/video/ThumbInfoXmlReader';
import { generateLibraryPage } from './libraryPage';

const log = createLogger('HTTPServer');

/**
 * 内蔵HTTPサーバー。
 * 元: src/org/mineap/nndd/server/NNDDHttpService.as / ServerManager.as
 *
 * 提供エンドポイント:
 *
 *  - `POST /NNDDServer` ─ 旧仕様の XML API (互換用)
 *  - `GET  /NNDDServer/{videoId}` ─ ローカル動画ストリーミング (Range対応)
 *
 *  - `GET  /api/library` ─ ライブラリ一覧 (JSON)
 *  - `GET  /api/mylist` ─ マイリスト一覧 (JSON)
 *  - `GET  /api/video/:id` ─ ローカル動画情報 (JSON)
 *  - `GET  /api/video/:id/stream` ─ 上記同等 (互換alias)
 */
export class NnddHttpServer {
  private app: Express;
  private server: http.Server | null = null;
  private port: number;
  private allowVideo: boolean;
  private allowExternal: boolean;
  private allowMyList: boolean;

  constructor(private readonly library: LibraryManager) {
    this.app = express();
    this.app.disable('x-powered-by');
    this.app.use(express.text({ type: 'application/xml', limit: '256kb' }));
    this.app.use(express.text({ type: 'text/xml', limit: '256kb' }));
    this.app.use(express.json({ limit: '256kb' }));
    this.setupRoutes();

    const cfg = getConfigStore();
    const httpCfg = cfg.get('httpServer');
    this.port = httpCfg.port ?? 12345;
    this.allowVideo = httpCfg.allowVideo ?? true;
    this.allowExternal = httpCfg.allowExternal ?? false;
    this.allowMyList = httpCfg.allowMyList ?? true;
  }

  /** サーバー起動 */
  start(): Promise<{ port: number }> {
    if (this.server) return Promise.resolve({ port: this.port });
    const bindAddr = this.allowExternal ? '0.0.0.0' : '127.0.0.1';
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, bindAddr, () => {
        const addr = server.address();
        const port =
          typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = port;
        log.info(`HTTP server listening on http://${bindAddr}:${port}`);
        resolve({ port });
      });
      server.on('error', reject);
      this.server = server;
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        log.info('HTTP server stopped');
        resolve();
      });
    });
  }

  setAllowVideo(allow: boolean): void {
    this.allowVideo = allow;
  }

  getPort(): number {
    return this.port;
  }

  getAllowExternal(): boolean {
    return this.allowExternal;
  }

  private setupRoutes(): void {
    // 全リクエストをログ
    this.app.use((req, _res, next) => {
      log.info(`→ ${req.method} ${req.url} from ${req.ip} [CT:${req.headers['content-type'] ?? 'none'} CL:${req.headers['content-length'] ?? 'none'}]`);
      next();
    });

    // ヘルスチェック
    this.app.get('/health', (_req, res) => {
      res.json({ ok: true, app: 'nndd-electron' });
    });

    // --- 旧仕様 NNDDServer ---
    // 本家NNDDはActionScript URLRequest.data=String のため Content-Type が
    // application/x-www-form-urlencoded になる。type:'*/*' で全形式を受け付ける。
    // ActionScriptのURLRequestはContent-Typeを送らないためexpressのbody-parserが
    // スキップする。Content-Typeに関係なく生バイトを読み取るカスタムパーサーを使う。
    const lanRawParser: express.RequestHandler = (req, _res, next) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        req.body = Buffer.concat(chunks).toString('utf-8');
        next();
      });
      req.on('error', next);
    };
    this.app.all('/NNDDServer', lanRawParser, (req, res) => this.handleLegacyXml(req, res));
    this.app.all('/NNDDServer/', lanRawParser, (req, res) => this.handleLegacyXml(req, res));
    this.app.get('/NNDDServer/:videoId', (req, res) =>
      this.handleVideoStream(req, res)
    );

    // --- 新JSON API ---
    this.app.get('/api/library', (_req, res) => {
      const videoDir = this.library.videoDir;
      const videos = this.library.videoDao.listWithTags()
        .filter((v) => v.uri.startsWith(videoDir));
      res.json(videos.map((v) => this.toClientVideo(v)));
    });

    this.app.get('/api/mylist', (_req, res) => {
      res.json(this.library.myListDao.list());
    });

    this.app.get('/api/video/:id', (req, res) => {
      const v = this.findVideoByKey(req.params.id);
      if (!v) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json(this.toClientVideo(v));
    });

    this.app.get('/api/video/:id/stream', (req, res) =>
      this.handleVideoStream(req, res)
    );

    this.app.get('/api/video/:id/thumb', (req, res) =>
      this.handleThumb(req, res)
    );

    this.app.get('/api/video/:id/comments', (req, res) =>
      this.handleComments(req, res)
    );

    this.app.get('/library', (_req, res) => {
      res.type('text/html; charset=utf-8').send(generateLibraryPage());
    });

    // 404
    this.app.use((req, res) => {
      log.debug('not found:', req.method, req.path);
      res.status(404).json({ error: 'not found' });
    });
  }

  /**
   * 旧仕様: XML body を受けて XML で返す。
   * 本家NNDD互換 (GET_VIDEO_ID_LIST 等) と旧エイリアス (GetVideoIdList 等) の両方を受け付ける。
   */
  private handleLegacyXml(req: Request, res: Response): void {
    const raw = req.body;
    const xml = Buffer.isBuffer(raw)
      ? raw.toString('utf-8')
      : typeof raw === 'string'
      ? raw
      : String(raw ?? '');
    log.debug('legacy NNDDServer POST:', xml.slice(0, 200));

    log.info([
      `NNDDServer ${req.method} from ${req.ip}`,
      `  URL: ${req.url}`,
      `  Content-Type: ${req.headers['content-type'] ?? 'none'}`,
      `  Content-Length: ${req.headers['content-length'] ?? 'none'}`,
      `  Query: ${JSON.stringify(req.query)}`,
      `  Body bytes: ${xml.length}`,
      `  Body(200): ${xml.slice(0, 200)}`
    ].join('\n'));

    const typeMatch = xml.match(/type=["']([^"']+)["']/);
    const type = typeMatch?.[1] ?? '';
    log.info(`NNDDServer request type: "${type}"`);

    try {
      // 本家NNDD互換: GET_VIDEO_ID_LIST
      if (type === 'GET_VIDEO_ID_LIST' || type === 'GetVideoList' || type === 'GetVideoIdList') {
        const videos = this.library.videoDao.listWithTags();
        if (type === 'GET_VIDEO_ID_LIST') {
          res.type('application/xml').send(this.buildNNDDREVideoIdListXml(videos));
        } else {
          res.type('application/xml').send(this.buildVideoListXml(videos));
        }
        return;
      }
      // 本家NNDD互換: GET_MYLIST_LIST
      if (type === 'GET_MYLIST_LIST' || type === 'GetMyList') {
        if (!this.allowMyList) {
          res.status(403).send('mylist sharing disabled');
          return;
        }
        const mls = this.library.myListDao.list();
        if (type === 'GET_MYLIST_LIST') {
          res.type('application/xml').send(this.buildNnddMyListXml(mls));
        } else {
          res.type('application/xml').send(this.buildMyListXml(mls));
        }
        return;
      }
      // 本家NNDD互換: GET_VIDEO_BY_ID
      if (type === 'GET_VIDEO_BY_ID' || type === 'GetVideoById' || type === 'GetMyListById') {
        const idMatch = xml.match(/id=["']([^"']+)["']/) ?? xml.match(/<id>([^<]+)<\/id>/);
        if (!idMatch) {
          res.status(400).send('missing id');
          return;
        }
        const v = this.findVideoByKey(idMatch[1]);
        if (!v) {
          res.status(404).send('not found');
          return;
        }
        if (type === 'GET_VIDEO_BY_ID') {
          res.type('application/xml').send(this.buildNNDDREVideoByIdXml(v, req));
        } else {
          res.type('application/xml').send(this.buildVideoListXml([v]));
        }
        return;
      }
      // 本家NNDD互換: GET_MYLIST_BY_ID (再生状況同期)
      if (type === 'GET_MYLIST_BY_ID') {
        if (!this.allowMyList) {
          res.status(403).send('mylist sharing disabled');
          return;
        }
        const videoIdMatches = [...xml.matchAll(/id=["']([^"']+)["']/g)].slice(1);
        const videoIds = videoIdMatches.map((m) => m[1]);
        const videos = videoIds
          .map((id) => this.findVideoByKey(id))
          .filter((v): v is NonNullable<typeof v> => v !== null);
        res.type('application/xml').send(this.buildNnddMyListByIdXml(videos));
        return;
      }
      // 接続確認 (本家NNDD NNDD.mxml: URLLoader.load() = GET, body なし)
      if (!type) {
        res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><nnddResponse/>');
        return;
      }
      res.status(400).send('unknown request type');
    } catch (e) {
      log.error('legacy handler error:', e);
      res.status(500).send('server error');
    }
  }

  /**
   * 動画ファイルをストリーミング配信 (Range対応)。
   */
  private handleVideoStream(req: Request, res: Response): void {
    if (!this.allowVideo) {
      res.status(403).send('video sharing disabled');
      return;
    }
    const paramId = req.params['id'] ?? req.params['videoId'] ?? '';
    const v = this.findVideoByKey(Array.isArray(paramId) ? paramId[0] : paramId);
    if (!v || !fs.existsSync(v.uri)) {
      res.status(404).send('video not found');
      return;
    }
    const stat = fs.statSync(v.uri);
    const size = stat.size;
    const range = req.headers.range;

    const contentType =
      this.contentTypeFromPath(v.uri) ?? 'application/octet-stream';

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.status(416).end();
        return;
      }
      const start = m[1] === '' ? 0 : parseInt(m[1], 10);
      const end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
      if (start >= size || end >= size || start > end) {
        res
          .status(416)
          .setHeader('Content-Range', `bytes */${size}`)
          .end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', contentType);
      fs.createReadStream(v.uri, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(v.uri).pipe(res);
  }

  private handleThumb(req: Request, res: Response): void {
    const v = this.findVideoByKey(String(req.params['id'] ?? ''));
    if (!v) {
      res.status(404).end();
      return;
    }
    const base = v.uri.replace(/\.[^.]+$/, '');
    const candidates = [
      base + VideoFileSuffix.THUMB_IMAGE,
      base + VideoFileSuffix.THUMB_IMAGE_LEGACY
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const ct = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(p).pipe(res);
        return;
      }
    }
    res.status(404).end();
  }

  private handleComments(req: Request, res: Response): void {
    const v = this.findVideoByKey(String(req.params['id'] ?? ''));
    if (!v) {
      res.json([]);
      return;
    }
    const base = v.uri.replace(/\.[^.]+$/, '');
    const normal = CommentXmlReader.readFile(base + VideoFileSuffix.COMMENT_XML);
    const owner = CommentXmlReader.readFile(base + VideoFileSuffix.OWNER_COMMENT_XML);

    // [NowComment].json が存在すれば今コメno一覧でフィルタ、なければ全件
    let nowNos: Set<number> | null = null;
    const nowJsonPath = base + VideoFileSuffix.NOW_COMMENT_JSON;
    if (fs.existsSync(nowJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(nowJsonPath, 'utf-8')) as number[];
        nowNos = new Set(parsed);
      } catch {
        // 読み取り失敗時は全件
      }
    }

    const nowComments = nowNos
      ? normal.filter((c) => nowNos!.has(c.no))
      : [...normal].sort((a, b) => b.no - a.no).slice(0, 1000);
    const merged = [...nowComments, ...owner].sort((a, b) => a.vposMs - b.vposMs);
    res.json(
      merged.map((c) => ({
        no: c.no,
        vposMs: c.vposMs,
        text: c.text,
        size: c.sizeCommand,
        pos: c.positionCommand,
        color: c.color,
        strokeColor: c.strokeColor
      }))
    );
  }

  private findVideoByKey(key: string): NNDDREVideo | null {
    if (!key) return null;
    return this.library.videoDao.getByKey(key);
  }

  private toClientVideo(v: NNDDREVideo): Record<string, unknown> {
    const base = v.uri.replace(/\.[^.]+$/, '');
    const thumbInfoPath = base + VideoFileSuffix.THUMB_INFO_XML;
    const thumbInfo = ThumbInfoXmlReader.parseFile(thumbInfoPath);
    return {
      id: v.id,
      videoId: this.extractVideoId(v.uri),
      videoName: v.videoName,
      tags: v.tagStrings,
      duration: v.time,
      thumbUrl: v.thumbUrl,
      playCount: v.playCount,
      creationDate: v.creationDate,
      lastPlayDate: v.lastPlayDate,
      pubDate: v.pubDate,
      uri: v.uri,
      folder: path.basename(path.dirname(v.uri)),
      description: thumbInfo?.description ?? null,
      viewCount: thumbInfo?.viewCount ?? null,
      commentCount: thumbInfo?.commentCount ?? null,
      mylistCount: thumbInfo?.mylistCount ?? null,
      ownerNickname: thumbInfo?.ownerNickname ?? null,
      ownerIconUrl: thumbInfo?.ownerIconUrl ?? null,
    };
  }

  private extractVideoId(uri: string): string | null {
    const m = uri.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    return m ? m[1] : null;
  }

  /** 本家NNDD互換: GET_VIDEO_ID_LIST レスポンス */
  private buildNNDDREVideoIdListXml(videos: NNDDREVideo[]): string {
    const esc = (s: string): string =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<nnddResponse>'];
    for (const v of videos) {
      const vid = this.extractVideoId(v.uri) ?? '';
      if (!vid) continue;
      const filename = path.basename(v.uri);
      lines.push(`  <video id="${esc(vid)}" isEconomy="false">${esc(filename)}</video>`);
    }
    lines.push('</nnddResponse>');
    return lines.join('\n');
  }

  /** 本家NNDD互換: GET_MYLIST_LIST レスポンス */
  private buildNnddMyListXml(
    mylists: ReturnType<LibraryManager['myListDao']['list']>
  ): string {
    const esc = (s: string): string =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rssTypeMap: Record<string, string> = {
      mylist: 'MY_LIST',
      channel: 'CHANNEL',
      community: 'MY_LIST',
      userUpload: 'MY_LIST',
      series: 'MY_LIST'
    };
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<nnddResponse>'];
    for (const m of mylists) {
      const idMatch = m.myListUrl.match(/(\d+)\/?$/);
      const id = idMatch ? idMatch[1] : m.myListUrl;
      const rssType = rssTypeMap[m.type] ?? 'MY_LIST';
      lines.push(`  <rss id="${esc(id)}" rssType="${rssType}" name="${esc(m.myListName)}"/>`);
    }
    lines.push('</nnddResponse>');
    return lines.join('\n');
  }

  /** 本家NNDD互換: GET_VIDEO_BY_ID レスポンス */
  private buildNNDDREVideoByIdXml(v: NNDDREVideo, req: Request): string {
    const esc = (s: string): string =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const vid = this.extractVideoId(v.uri) ?? '';
    const filename = path.basename(v.uri);
    const ext = path.extname(v.uri).slice(1);
    const localAddr = (req.socket.localAddress ?? '').replace(/^::ffff:/, '');
    const videoUrl = `http://${localAddr}:${this.port}/NNDDServer/${esc(vid)}`;
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<nnddResponse>',
      `  <video id="${esc(vid)}" isEconomy="false" videoUrl="${esc(videoUrl)}" extension="${esc(ext)}">${esc(filename)}</video>`,
      '</nnddResponse>'
    ];
    return lines.join('\n');
  }

  /** 本家NNDD互換: GET_MYLIST_BY_ID レスポンス (再生状況同期) */
  private buildNnddMyListByIdXml(videos: NNDDREVideo[]): string {
    const esc = (s: string): string =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<nnddResponse>', '  <channel>'];
    for (const v of videos) {
      const vid = this.extractVideoId(v.uri) ?? '';
      const played = !v.yetReading ? 'true' : 'false';
      lines.push('    <item>');
      lines.push(`      <title>${esc(v.videoName)}</title>`);
      lines.push(`      <link>https://www.nicovideo.jp/watch/${esc(vid)}</link>`);
      lines.push(`      <played>${played}</played>`);
      lines.push('    </item>');
    }
    lines.push('  </channel>');
    lines.push('</nnddResponse>');
    return lines.join('\n');
  }

  private buildVideoListXml(videos: NNDDREVideo[]): string {
    const esc = (s: string): string =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<NNDDServer><response status="success"><videos>');
    for (const v of videos) {
      const vid = this.extractVideoId(v.uri) ?? '';
      lines.push(
        `  <video id="${esc(vid)}" name="${esc(v.videoName)}" time="${v.time}" economy="0">`
      );
      for (const t of v.tagStrings) {
        lines.push(`    <tag>${esc(t)}</tag>`);
      }
      lines.push('  </video>');
    }
    lines.push('</videos></response></NNDDServer>');
    return lines.join('\n');
  }

  private buildMyListXml(
    mylists: ReturnType<LibraryManager['myListDao']['list']>
  ): string {
    const esc = (s: string): string =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<NNDDServer><response status="success"><mylists>');
    for (const m of mylists) {
      lines.push(
        `  <mylist url="${esc(m.myListUrl)}" name="${esc(m.myListName)}" type="${esc(m.type)}" />`
      );
    }
    lines.push('</mylists></response></NNDDServer>');
    return lines.join('\n');
  }

  private contentTypeFromPath(p: string): string | null {
    const ext = path.extname(p).toLowerCase();
    switch (ext) {
      case '.mp4':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      case '.mkv':
        return 'video/x-matroska';
      case '.flv':
        return 'video/x-flv';
      case '.swf':
        return 'application/x-shockwave-flash';
      default:
        return null;
    }
  }
}
