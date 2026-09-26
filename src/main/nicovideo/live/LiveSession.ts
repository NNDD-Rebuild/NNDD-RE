import type {
  LiveCommentRange,
  LiveEvent,
  LiveNotice,
  LiveProgramInfo,
  LiveStartResult,
  NNDDREComment
} from '@shared/types';
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
/** これを超えるコメント数の番組は全件取得せず、再生位置の周辺だけ取得する */
const FULL_ARCHIVE_LIMIT = 10_000;
/** 周辺取得の範囲: 指定位置の何秒後から、何秒前まで遡るか */
const AROUND_AHEAD_SEC = 300;
const AROUND_BEHIND_SEC = 60;
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
  /** 追っかけ再生 (放送中に過去へ巻き戻せる HLS) で視聴するか */
  private chasePlay = false;
  /** 過去コメント取得用 (タイムシフト / 追っかけ再生)。再接続しても取り直さない */
  private archiveNdgr: NdgrClient | null = null;
  /** 周辺取得用 (commentFetchMode = seek) */
  private aroundNdgr: NdgrClient | null = null;
  private viewUri: string | null = null;
  private commentFetchMode: LiveStartResult['commentFetchMode'] = 'all';

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
    this.chasePlay = !this.isTimeshift && page.program.chasePlayEnabled;
    this.commentFetchMode = page.program.commentCount > FULL_ARCHIVE_LIMIT ? 'seek' : 'all';
    this.emit({ type: 'state', state: 'connecting' });
    void this.connect(page.webSocketUrl, false);
    return {
      program: page.program,
      isTimeshift: this.isTimeshift,
      chasePlay: this.chasePlay,
      commentFetchMode: this.commentFetchMode
    };
  }

  stop(): void {
    this.stopped = true;
    this.archiveNdgr?.stop();
    this.archiveNdgr = null;
    this.aroundNdgr?.stop();
    this.aroundNdgr = null;
    this.cleanupConnection();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  changeQuality(quality: string): void {
    this.quality = quality;
    this.send({ type: 'changeStream', data: this.streamRequest() });
  }

  private streamRequest(): Record<string, unknown> {
    return { quality: this.quality, protocol: 'hls', latency: 'low', chasePlay: this.chasePlay };
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
        if (d.viewUri) this.viewUri = String(d.viewUri);
        if (d.viewUri && this.isTimeshift) {
          if (!this.archiveNdgr && this.commentFetchMode === 'all') this.startArchive(String(d.viewUri));
        } else if (d.viewUri && !this.ndgr) {
          // 開いた時点より前のコメントも全件取得する (コメントリストの表示と、追っかけ再生で巻き戻した位置で流す分)
          if (!this.archiveNdgr && this.commentFetchMode === 'all') this.startArchive(String(d.viewUri));
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

  /**
   * 指定した再生位置の周辺 (AROUND_BEHIND_SEC 前〜AROUND_AHEAD_SEC 後) のコメントを取得し、
   * archiveComments で送る。commentFetchMode = seek の番組で、シーク時や取得範囲の端に近づいたときに呼ばれる。
   * @returns 取得できた範囲。コメントサーバー未接続などで取得できなければ null
   */
  async fetchCommentsAround(vposMs: number): Promise<LiveCommentRange | null> {
    const base = this.program?.vposBaseTimeMs ?? 0;
    if (!this.viewUri || !base || this.stopped) return null;
    if (!this.aroundNdgr) this.aroundNdgr = new NdgrClient(this.viewUri, { onMessage: () => {}, onError: () => {} });
    const posSec = (base + vposMs) / 1000;
    const atSec = Math.min(posSec + AROUND_AHEAD_SEC, Date.now() / 1000);
    const untilSec = posSec - AROUND_BEHIND_SEC;
    const oldest = await this.aroundNdgr.fetchBackwardAround(atSec, untilSec, (messages) => {
      const comments = this.toComments(messages);
      if (comments.length > 0) this.emit({ type: 'archiveComments', comments, done: false });
    });
    return {
      // 取得できた最古の時刻が遡りたい位置より新しければ、そこまでしか埋まっていない
      fromVposMs: (oldest === null ? atSec : Math.max(oldest, untilSec)) * 1000 - base,
      toVposMs: atSec * 1000 - base
    };
  }

  /** PackedSegment の中身からコメント (chat / overflowed_chat) だけ取り出す */
  private toComments(messages: ChunkedMessage[]): NNDDREComment[] {
    const comments: NNDDREComment[] = [];
    for (const m of messages) {
      if (m.payload.case !== 'message') continue;
      const data = m.payload.value.data;
      const at = m.meta?.at ? Number(m.meta.at.seconds) * 1000 : 0;
      if (data.case === 'chat') comments.push(chatToComment(data.value, at));
      else if (data.case === 'overflowedChat') comments.push(chatToComment(data.value, at, false));
    }
    return comments;
  }

  /** タイムシフト・追っかけ再生: 過去コメントを全件取得して archiveComments で送る */
  private startArchive(viewUri: string, maxMessages = Infinity): void {
    const ndgr = new NdgrClient(viewUri, { onMessage: () => {}, onError: () => {} });
    this.archiveNdgr = ndgr;
    let total = 0;
    void ndgr
      .fetchArchive((messages) => {
        const comments = this.toComments(messages);
        total += comments.length;
        this.emit({ type: 'archiveComments', comments, done: false });
      }, maxMessages)
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
