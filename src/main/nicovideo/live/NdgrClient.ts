import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { sizeDelimitedDecodeStream } from '@bufbuild/protobuf/wire';
import { NicoHeaders } from '@shared/constants';
import { createLogger } from '../../util/Logger';
import {
  type ChunkedMessage,
  ChunkedEntrySchema,
  ChunkedMessageSchema
} from './gen/dwango/nicolive/chat/service/edge/payload_pb';

const log = createLogger('NdgrClient');

/** 同一メッセージの重複配信を弾くため覚えておく meta.id の上限 */
const SEEN_ID_LIMIT = 5000;
/** 連続失敗がこの回数を超えたら onError を通知する */
const MAX_FAILURES = 5;

export interface NdgrHandlers {
  onMessage: (msg: ChunkedMessage) => void;
  onError: (err: unknown) => void;
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

  constructor(
    private readonly viewUri: string,
    private readonly handlers: NdgrHandlers
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

  private async viewLoop(): Promise<void> {
    let at = 'now';
    let firstRound = true;
    let failures = 0;
    while (!this.stopped) {
      try {
        let next: string | null = null;
        const sep = this.viewUri.includes('?') ? '&' : '?';
        for await (const entry of this.streamProto(`${this.viewUri}${sep}at=${at}`, ChunkedEntrySchema)) {
          const e = entry.entry;
          if (e.case === 'segment') {
            this.openSegment(e.value.uri);
          } else if (e.case === 'previous' && firstRound && at !== 'now') {
            // 接続直後だけ直前区間も読み、コメントリストを空で始めないようにする
            this.openSegment(e.value.uri);
          } else if (e.case === 'next') {
            next = e.value.at.toString();
          }
        }
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

  private openSegment(uri: string): void {
    if (this.openedSegments.has(uri)) return;
    this.openedSegments.add(uri);
    void (async () => {
      try {
        for await (const msg of this.streamProto(uri, ChunkedMessageSchema)) {
          const id = msg.meta?.id;
          if (id) {
            if (this.seenIds.has(id)) continue;
            this.seenIds.add(id);
            if (this.seenIds.size > SEEN_ID_LIMIT) {
              // Set は挿入順なので先頭から古いものを捨てる
              const oldest = this.seenIds.values().next().value;
              if (oldest !== undefined) this.seenIds.delete(oldest);
            }
          }
          this.handlers.onMessage(msg);
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
