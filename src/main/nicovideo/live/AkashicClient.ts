import type { LiveAkashicBatch, LiveAkashicEvent } from '@shared/types';
import { createLogger } from '../../util/Logger';
import { NdgrClient } from './NdgrClient';
import type { AkashicMessageEvent } from './gen/dwango/nicolive/chat/data/atoms/akashic_pb';
import type { ChunkedMessage } from './gen/dwango/nicolive/chat/service/edge/payload_pb';

const log = createLogger('AkashicClient');

function toEvent(e: AkashicMessageEvent): LiveAkashicEvent {
  return {
    type: e.type,
    playId: e.playId,
    ...(e.ignorable ? { ignorable: true } : {}),
    ...(e.transient ? { transient: true } : {}),
    ...(e.parameters ? { parameters: e.parameters as Record<string, unknown> } : {})
  };
}

/**
 * ニコ生ゲーム (akashic) のメッセージサーバー (mpn) の購読。
 *
 * 視聴 WebSocket の akashicMessageServer.viewUri はコメントサーバーと同じ NDGR 形式で、
 * 流れてくる NicoliveState.akashic_state (ゲームの進行を表すイベント) を取り出して batch として渡す。
 * 途中参加でも進行中のゲームを復元できるよう、接続時の状態スナップショットも読む
 * (スナップショットは join + shared、以降の segment は continuation + shared を適用する)。
 */
export class AkashicClient {
  private readonly ndgr: NdgrClient;

  constructor(
    viewUri: string,
    private readonly onBatch: (batch: LiveAkashicBatch) => void,
    onError: (err: unknown) => void
  ) {
    this.ndgr = new NdgrClient(viewUri, { onMessage: (m, fromSnapshot) => this.onMessage(m, fromSnapshot === true), onError }, {
      readSnapshot: true
    });
  }

  start(): void {
    this.ndgr.start();
  }

  stop(): void {
    this.ndgr.stop();
  }

  private onMessage(msg: ChunkedMessage, fromSnapshot: boolean): void {
    if (msg.payload.case !== 'state') return;
    const st = msg.payload.value.akashicState;
    if (!st) return;
    const batch: LiveAkashicBatch = {
      epoch: Number(st.epoch),
      snapshot: fromSnapshot,
      join: st.join.map(toEvent),
      continuation: st.continuation.map(toEvent),
      shared: st.shared.map(toEvent)
    };
    log.debug(
      `akashic_state epoch=${batch.epoch} snapshot=${fromSnapshot} join=${batch.join.length} ` +
        `continuation=${batch.continuation.length} shared=${batch.shared.length}`
    );
    this.onBatch(batch);
  }
}
