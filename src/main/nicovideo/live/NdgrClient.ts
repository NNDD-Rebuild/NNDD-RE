import { fromBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { sizeDelimitedDecodeStream } from '@bufbuild/protobuf/wire';
import { NicoHeaders } from '@shared/constants';
import { createLogger } from '../../util/Logger';
import {
  type ChunkedMessage,
  type PackedSegment,
  ChunkedEntrySchema,
  ChunkedMessageSchema,
  PackedSegmentSchema
} from './gen/dwango/nicolive/chat/service/edge/payload_pb';

const log = createLogger('NdgrClient');

/** 同一メッセージの重複配信を弾くため覚えておく meta.id の上限 */
const SEEN_ID_LIMIT = 5000;
/** 連続失敗がこの回数を超えたら onError を通知する */
const MAX_FAILURES = 5;

export interface NdgrHandlers {
  /** fromSnapshot: 接続時点の状態スナップショットから読んだメッセージか (readSnapshot 指定時のみ true になりうる) */
  onMessage: (msg: ChunkedMessage, fromSnapshot?: boolean) => void;
  onError: (err: unknown) => void;
}

export interface NdgrOptions {
  /**
   * view API が返す状態スナップショット (backward.snapshot) も読む。
   * 途中参加でも現在の状態 (ニコ生ゲームの進行など) を復元したいときに使う。
   * スナップショットを読み終えてから segment を開くので、onMessage にはスナップショット → segment の順で届く
   */
  readSnapshot?: boolean;
}

/**
 * ニコニコ生放送のコメントサーバー (NDGR) クライアント。
 *
 * 流れ:
 *  1. view API `viewUri?at=now` → ChunkedEntry.next.at を得る
 *  2. `viewUri?at={at}` をストリーミング受信。segment (現在区間) / previous (直前区間) の URI と、
 *     次に読む next.at が順に流れてくる
 *  3. segment URI をストリーミング受信すると ChunkedMessage (コメント・状態変化等) が流れてくる
 *
 * レスポンスはいずれも varint 長さプレフィックス付き protobuf の連続。
 */
export class NdgrClient {
  private readonly ac = new AbortController();
  private readonly openedSegments = new Set<string>();
  private readonly seenIds = new Set<string>();
  private snapshotRead = false;

  constructor(
    private readonly viewUri: string,
    private readonly handlers: NdgrHandlers,
    private readonly options: NdgrOptions = {}
  ) {}

  start(): void {
    void this.viewLoop();
  }

  stop(): void {
    this.ac.abort();
  }

  private get stopped(): boolean {
    return this.ac.signal.aborted;
  }

  /**
   * タイムシフト用: 番組の過去コメントを全件取得する。
   *
   * view API の backward (BackwardSegment.segment.uri) から Backward API を取得すると
   * PackedSegment (ChunkedMessage の配列、長さプレフィックス無しの単体メッセージ) が返る。
   * PackedSegment.next.uri を辿ると更に古い区間が取れる。
   * 1ページ毎に onBatch を呼ぶ (新しい区間 → 古い区間の順)。
   * @param maxMessages この件数以上取得したら古い方へ遡るのをやめる (省略時は全件)
   */
  async fetchArchive(
    onBatch: (messages: ChunkedMessage[]) => void,
    maxMessages = Infinity
  ): Promise<void> {
    let uri = await this.findBackwardUri('now');
    if (!uri) throw new Error('NDGR: 過去コメントの取得先が見つかりませんでした');
    let count = 0;
    while (uri && !this.stopped && count < maxMessages) {
      const packed = await this.fetchPacked(uri);
      onBatch(packed.messages);
      count += packed.messages.length;
      uri = packed.next?.uri;
    }
  }

  /**
   * 指定時刻より前のコメントを、untilSec に届くまで (最大 maxPages ページ) 取得する。
   * view API に過去の時刻を at で渡すと、その時点から遡る backward が返る
   * (コメント数が多い番組で、シーク位置の周辺だけ取得するのに使う)。
   * @returns 取得できた最も古いコメントの時刻 (unix 秒)。1件も無ければ null
   */
  async fetchBackwardAround(
    atSec: number,
    untilSec: number,
    onBatch: (messages: ChunkedMessage[]) => void,
    maxPages = 4
  ): Promise<number | null> {
    let uri = await this.findBackwardUri(String(Math.floor(atSec)));
    let oldest: number | null = null;
    for (let page = 0; uri && page < maxPages && !this.stopped; page++) {
      const packed = await this.fetchPacked(uri);
      onBatch(packed.messages);
      for (const m of packed.messages) {
        const t = m.meta?.at ? Number(m.meta.at.seconds) : null;
        if (t !== null && (oldest === null || t < oldest)) oldest = t;
      }
      if (oldest !== null && oldest <= untilSec) break;
      uri = packed.next?.uri;
    }
    return oldest;
  }

  /** view API を at から辿り、backward (過去コメントの起点 URI) を探す */
  private async findBackwardUri(startAt: string): Promise<string | undefined> {
    const sep = this.viewUri.includes('?') ? '&' : '?';
    let at = startAt;
    // at=now は next.at だけ返すので、次の at で backward が流れてくるまで辿る
    for (let i = 0; i < 3 && !this.stopped; i++) {
      let next: string | null = null;
      for await (const entry of this.streamProto(`${this.viewUri}${sep}at=${at}`, ChunkedEntrySchema)) {
        const e = entry.entry;
        if (e.case === 'backward') return e.value.segment?.uri;
        if (e.case === 'next') {
          next = e.value.at.toString();
          break;
        }
      }
      if (!next) return undefined;
      at = next;
    }
    return undefined;
  }

  private async fetchPacked(uri: string): Promise<PackedSegment> {
    const res = await fetch(uri, {
      headers: { 'User-Agent': NicoHeaders.USER_AGENT },
      signal: this.ac.signal
    });
    if (!res.ok) throw new Error(`NDGR backward HTTP ${res.status}`);
    return fromBinary(PackedSegmentSchema, new Uint8Array(await res.arrayBuffer()));
  }

  private async viewLoop(): Promise<void> {
    let at = 'now';
    let firstRound = true;
    let failures = 0;
    while (!this.stopped) {
      try {
        let next: string | null = null;
        // スナップショットを先に流したいときだけ、それが読み終わるまで segment の購読を遅らせる
        const deferred: string[] = [];
        const openOrDefer = (uri: string): void => {
          if (this.options.readSnapshot && !this.snapshotRead) deferred.push(uri);
          else this.openSegment(uri);
        };
        const sep = this.viewUri.includes('?') ? '&' : '?';
        for await (const entry of this.streamProto(`${this.viewUri}${sep}at=${at}`, ChunkedEntrySchema)) {
          const e = entry.entry;
          if (e.case === 'segment') {
            openOrDefer(e.value.uri);
          } else if (e.case === 'previous' && firstRound && at !== 'now') {
            // 接続直後だけ直前区間も読み、コメントリストを空で始めないようにする
            openOrDefer(e.value.uri);
          } else if (e.case === 'backward' && this.options.readSnapshot && !this.snapshotRead) {
            const uri = e.value.snapshot?.uri;
            if (uri) {
              // 応答はセグメントの区切りまで開いたままなので、終わりを待たずここで読む
              this.snapshotRead = true;
              await this.readSnapshotMessages(uri);
              for (const d of deferred.splice(0)) this.openSegment(d);
            }
          } else if (e.case === 'next') {
            next = e.value.at.toString();
          }
        }
        // スナップショットが無かった場合 (backward が来なかった) も、溜めた segment は開く
        for (const d of deferred.splice(0)) this.openSegment(d);
        // スナップショットを待つのは接続直後の 1 往復だけ (以降の往復で segment の購読を遅らせない)
        if (at !== 'now') this.snapshotRead = true;
        if (!next) throw new Error('NDGR view: next.at が返りませんでした');
        if (at !== 'now') firstRound = false;
        at = next;
        failures = 0;
      } catch (e) {
        if (this.stopped) return;
        failures++;
        log.warn(`view failed (${failures}):`, e);
        if (failures > MAX_FAILURES) {
          this.handlers.onError(e);
          return;
        }
        await this.sleep(Math.min(30_000, 1000 * 2 ** failures));
      }
    }
  }

  /** 状態スナップショット (ChunkedMessage の連続) を読み切る。失敗しても segment の購読は続ける */
  private async readSnapshotMessages(uri: string): Promise<void> {
    try {
      for await (const msg of this.streamProto(uri, ChunkedMessageSchema)) {
        if (this.rememberId(msg)) this.handlers.onMessage(msg, true);
      }
    } catch (e) {
      if (!this.stopped) log.warn('snapshot failed:', e);
    }
  }

  /** 初めて見る meta.id なら true (重複配信の除外)。meta.id が無いメッセージは常に true */
  private rememberId(msg: ChunkedMessage): boolean {
    const id = msg.meta?.id;
    if (!id) return true;
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_ID_LIMIT) {
      // Set は挿入順なので先頭から古いものを捨てる
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    return true;
  }

  private openSegment(uri: string): void {
    if (this.openedSegments.has(uri)) return;
    this.openedSegments.add(uri);
    void (async () => {
      try {
        for await (const msg of this.streamProto(uri, ChunkedMessageSchema)) {
          if (this.rememberId(msg)) this.handlers.onMessage(msg);
        }
      } catch (e) {
        if (!this.stopped) log.warn('segment failed:', e);
      } finally {
        // 区間の URI は再利用されないため、受信済み集合が際限なく育たないよう消しておく
        setTimeout(() => this.openedSegments.delete(uri), 60_000);
      }
    })();
  }

  private async *streamProto<Desc extends DescMessage>(
    url: string,
    schema: Desc
  ): AsyncGenerator<MessageShape<Desc>> {
    const res = await fetch(url, {
      headers: { 'User-Agent': NicoHeaders.USER_AGENT },
      signal: this.ac.signal
    });
    if (!res.ok || !res.body) throw new Error(`NDGR HTTP ${res.status}: ${url}`);
    yield* sizeDelimitedDecodeStream(schema, res.body as unknown as AsyncIterable<Uint8Array>);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.ac.signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
