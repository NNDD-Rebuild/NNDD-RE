import type { LiveEvent, LiveNotice, LiveProgramInfo, LiveStartResult, NNDDREComment } from '@shared/types';
import { NicoHeaders } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import { NdgrClient } from './NdgrClient';
import { chatToComment } from './LiveChatConverter';
import {
  LIVE_ORIGIN,
  describeUnavailable,
  unavailableError,
  fetchLiveWatchPage
} from './LiveWatchPage';
import type { ChunkedMessage } from './gen/dwango/nicolive/chat/service/edge/payload_pb';
import { ProgramStatus_State } from './gen/dwango/nicolive/chat/data/atoms_pb';

const log = createLogger('LiveSession');

/** 視聴WebSocketの stream.cookies (HLS 取得に必要な CloudFront 署名Cookie 等) */
export interface LiveStreamCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
}

interface WsMessage {
  type: string;
  data?: any;
}

const MAX_RECONNECTS = 5;
/** コメントを renderer へまとめて送る間隔 (受信毎に IPC すると多コメ時に重い) */
const COMMENT_FLUSH_MS = 200;

/**
 * 生放送1番組分の視聴セッション。
 *
 * - watchページ → 視聴WebSocket (startWatching / keepSeat / pong) を維持
 * - stream メッセージで HLS URL と署名Cookie を受け取る
 * - messageServer メッセージの viewUri で NdgrClient を起動しコメントを受信
 * - 受信内容は LiveEvent として emit する
 */
export class LiveSession {
  private ws: WebSocket | null = null;
  private ndgr: NdgrClient | null = null;
  private keepSeatTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pendingComments: NNDDREComment[] = [];
  private stopped = false;
  private ended = false;
  private reconnects = 0;
  private quality = 'abr';
  private program: LiveProgramInfo | null = null;
  private isTimeshift = false;

  constructor(
    private readonly programId: string,
    private readonly emit: (ev: LiveEvent) => void,
    private readonly onStreamCookies: (cookies: LiveStreamCookie[]) => void
  ) {}

  /** watchページを解析して WebSocket 接続を始める */
  async start(): Promise<LiveStartResult> {
    const page = await fetchLiveWatchPage(this.programId);
    this.program = page.program;
    if (!page.webSocketUrl) throw unavailableError(page);
    // タイムシフト視聴時は視聴WebSocketの URL が .../watch/{id}/timeshift になる
    this.isTimeshift = /\/timeshift(\?|$)/.test(page.webSocketUrl);
    this.emit({ type: 'state', state: 'connecting' });
    void this.connect(page.webSocketUrl, false);
    return { program: page.program, isTimeshift: this.isTimeshift };
  }

  stop(): void {
    this.stopped = true;
    this.cleanupConnection();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  changeQuality(quality: string): void {
    this.quality = quality;
    this.send({ type: 'changeStream', data: this.streamRequest() });
  }

  private streamRequest(): Record<string, unknown> {
    return { quality: this.quality, protocol: 'hls', latency: 'low', chasePlay: false };
  }

  private async connect(wsUrl: string, reconnect: boolean): Promise<void> {
    const cookie = await NicoContext.get().cookieStore.cookieHeader(`${LIVE_ORIGIN}/`);
    if (this.stopped) return;
    // Node (undici) の WebSocket は第2引数オブジェクトで headers を渡せる (ブラウザ非互換の拡張)
    const WS = WebSocket as unknown as new (
      url: string,
      init: { headers: Record<string, string> }
    ) => WebSocket;
    const ws = new WS(wsUrl, {
      headers: {
        'User-Agent': NicoHeaders.USER_AGENT,
        Origin: LIVE_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {})
      }
    });
    this.ws = ws;

    ws.addEventListener('open', () => {
      log.info(`ws open (${this.programId}, reconnect=${reconnect})`);
      this.send({
        type: 'startWatching',
        data: {
          stream: this.streamRequest(),
          room: { protocol: 'webSocket', commentable: true },
          reconnect
        }
      });
    });
    ws.addEventListener('message', (ev) => {
      try {
        this.onWsMessage(JSON.parse(String(ev.data)) as WsMessage);
      } catch (e) {
        log.warn('ws message parse failed:', e);
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;
      log.info(`ws close code=${ev.code} reason=${ev.reason}`);
      this.cleanupConnection();
      if (!this.stopped && !this.ended) void this.reconnect();
    });
    ws.addEventListener('error', () => {
      log.warn('ws error');
    });
  }

  /** 切断時: watchページから新しいトークン付きURLを取り直して再接続する */
  private async reconnect(): Promise<void> {
    if (this.reconnects >= MAX_RECONNECTS) {
      this.emit({ type: 'state', state: 'error', message: 'サーバーとの接続が切れました。' });
      return;
    }
    this.reconnects++;
    this.emit({ type: 'state', state: 'reconnecting' });
    await new Promise((r) => setTimeout(r, 2000 * this.reconnects));
    if (this.stopped) return;
    try {
      const page = await fetchLiveWatchPage(this.programId);
      if (!page.webSocketUrl) {
        this.ended = true;
        this.emit({ type: 'state', state: 'ended', message: describeUnavailable(page) });
        return;
      }
      await this.connect(page.webSocketUrl, true);
    } catch (e) {
      log.warn('reconnect failed:', e);
      void this.reconnect();
    }
  }

  private cleanupConnection(): void {
    if (this.keepSeatTimer) clearInterval(this.keepSeatTimer);
    this.keepSeatTimer = null;
    this.ndgr?.stop();
    this.ndgr = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onWsMessage(msg: WsMessage): void {
    const d = msg.data ?? {};
    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong' });
        this.send({ type: 'keepSeat' });
        break;
      case 'seat': {
        const sec = Number(d.keepIntervalSec) || 30;
        if (this.keepSeatTimer) clearInterval(this.keepSeatTimer);
        this.keepSeatTimer = setInterval(() => this.send({ type: 'keepSeat' }), sec * 1000);
        this.reconnects = 0;
        this.emit({ type: 'state', state: 'watching' });
        break;
      }
      case 'stream':
        this.onStreamCookies((d.cookies as LiveStreamCookie[] | undefined) ?? []);
        this.emit({
          type: 'stream',
          uri: String(d.uri ?? ''),
          quality: String(d.quality ?? this.quality),
          availableQualities: Array.isArray(d.availableQualities) ? d.availableQualities.map(String) : []
        });
        break;
      case 'messageServer':
        if (d.viewUri && !this.ndgr && this.isTimeshift) {
          this.startArchive(String(d.viewUri));
        } else if (d.viewUri && !this.ndgr) {
          this.ndgr = new NdgrClient(String(d.viewUri), {
            onMessage: (m) => this.onNdgrMessage(m),
            onError: () =>
              this.emit({ type: 'notice', notice: { kind: 'notification', text: 'コメントサーバーとの接続に失敗しました', at: Date.now() } })
          });
          this.ndgr.start();
          this.startFlushTimer();
        }
        break;
      case 'statistics':
        this.emit({
          type: 'statistics',
          statistics: {
            viewers: Number(d.viewers) || 0,
            comments: Number(d.comments) || 0,
            adPoints: Number(d.adPoints) || 0,
            giftPoints: Number(d.giftPoints) || 0
          }
        });
        break;
      case 'disconnect': {
        const reason = String(d.reason ?? '');
        log.info(`disconnect: ${reason}`);
        if (reason === 'END_PROGRAM') {
          this.ended = true;
          this.emit({ type: 'state', state: 'ended', message: '番組が終了しました。' });
        } else if (reason === 'TAKEOVER') {
          // 同じアカウントで別の場所から視聴された
          this.ended = true;
          this.emit({ type: 'state', state: 'error', message: '別の場所で視聴が開始されたため切断されました。' });
        }
        break;
      }
      case 'error':
        log.warn('ws error message:', JSON.stringify(d));
        this.emit({ type: 'state', state: 'error', message: `エラー: ${String(d.code ?? 'unknown')}` });
        break;
      default:
        break;
    }
  }

  /** タイムシフト: 過去コメントを全件取得して archiveComments で送る */
  private startArchive(viewUri: string): void {
    const ndgr = new NdgrClient(viewUri, { onMessage: () => {}, onError: () => {} });
    this.ndgr = ndgr;
    let total = 0;
    void ndgr
      .fetchArchive((messages) => {
        const comments: NNDDREComment[] = [];
        for (const m of messages) {
          if (m.payload.case !== 'message') continue;
          const data = m.payload.value.data;
          const at = m.meta?.at ? Number(m.meta.at.seconds) * 1000 : 0;
          if (data.case === 'chat') comments.push(chatToComment(data.value, at));
          else if (data.case === 'overflowedChat') comments.push(chatToComment(data.value, at, false));
        }
        total += comments.length;
        this.emit({ type: 'archiveComments', comments, done: false });
      })
      .then(() => {
        log.info(`archive comments loaded: ${total}`);
        this.emit({ type: 'archiveComments', comments: [], done: true });
      })
      .catch((e) => {
        if (this.stopped) return;
        log.warn('archive fetch failed:', e);
        this.emit({ type: 'notice', notice: { kind: 'notification', text: '過去コメントの取得に失敗しました', at: Date.now() } });
        this.emit({ type: 'archiveComments', comments: [], done: true });
      });
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.pendingComments.length === 0) return;
      const comments = this.pendingComments;
      this.pendingComments = [];
      this.emit({ type: 'comments', comments });
    }, COMMENT_FLUSH_MS);
  }

  private onNdgrMessage(msg: ChunkedMessage): void {
    const atMs = msg.meta?.at ? Number(msg.meta.at.seconds) * 1000 + Math.floor(msg.meta.at.nanos / 1e6) : Date.now();
    const p = msg.payload;
    if (p.case === 'message') {
      const data = p.value.data;
      switch (data.case) {
        case 'chat':
          this.pendingComments.push(chatToComment(data.value, atMs));
          break;
        case 'overflowedChat':
          // 流量制限で画面に流れなかったコメント。リストにだけ載せる
          this.pendingComments.push(chatToComment(data.value, atMs, false));
          break;
        case 'simpleNotification': {
          const text = data.value.message.value;
          if (text) this.notice('notification', text, atMs);
          break;
        }
        case 'simpleNotificationV2':
          if (data.value.showInList && data.value.message) this.notice('notification', data.value.message, atMs);
          break;
        case 'gift': {
          const g = data.value;
          this.notice('gift', `${g.advertiserName} さんが「${g.itemName}」を贈りました (${g.point.toString()}pt) ${g.message}`.trim(), atMs);
          break;
        }
        case 'nicoad':
          if (data.value.versions.case === 'v1') this.notice('nicoad', data.value.versions.value.message, atMs);
          break;
        default:
          break;
      }
    } else if (p.case === 'state') {
      const s = p.value;
      if (s.marquee) {
        const op = s.marquee.display?.operatorComment;
        const notice: LiveNotice | null = op
          ? { kind: 'operator', text: op.content, link: op.link, at: atMs }
          : null;
        this.emit({ type: 'operatorComment', notice });
        if (notice) this.emit({ type: 'notice', notice });
      }
      if (s.programStatus?.state === ProgramStatus_State.Ended) {
        this.ended = true;
        this.emit({ type: 'state', state: 'ended', message: '番組が終了しました。' });
      }
    }
  }

  private notice(kind: LiveNotice['kind'], text: string, at: number): void {
    this.emit({ type: 'notice', notice: { kind, text, at } });
  }
}
