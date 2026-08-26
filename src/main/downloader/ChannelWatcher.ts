import { RssType } from '@shared/types';
import { LibraryManager } from '../db/LibraryManager';
import { ChannelClient } from '../nicovideo/channel/ChannelClient';
import { TrayManager } from '../tray/TrayManager';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { sendWebhookNotify } from '../notification/WebhookNotifier';

const log = createLogger('ChannelWatcher');

/**
 * 登録済みチャンネル (RssType.CHANNEL) の新着動画を定期ポーリングし、
 * 新しい動画を検知したら OS 通知 (トレイ) + Webhook 通知を行う。
 *
 * DLキューへの投入は行わない (通知のみ)。DLしたい場合は既存の
 * 「一括更新」(差分DL) やスケジュール自動DL機能を利用する。
 */
export class ChannelWatcher {
  private intervalId: NodeJS.Timeout | null = null;
  /** マイリストURL → 前回チェック時の先頭動画ID (アプリ起動中のみ保持) */
  private lastSeenVideoId = new Map<string, string>();

  constructor(
    private readonly library: LibraryManager,
    private readonly trayManager: TrayManager | null | undefined
  ) {}

  start(): void {
    this.stop();
    const cfg = getConfigStore().get('channelWatch');
    if (!cfg?.enabled) return;
    const intervalMs = Math.max(5, cfg.intervalMin || 30) * 60_000;
    log.info(`channel watcher started (interval=${cfg.intervalMin}min)`);
    this.intervalId = setInterval(() => this.tick(), intervalMs);
    // 起動直後にベースライン確立のため1回実行 (この回は通知しない)
    this.tick();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    const cfg = getConfigStore().get('channelWatch');
    if (!cfg?.enabled) return;

    const channels = this.library.myListDao
      .list()
      .filter((ml) => ml.type === RssType.CHANNEL);

    for (const ch of channels) {
      try {
        const id = ch.myListUrl;
        const { items } = await ChannelClient.fetchChannelVideos(id, 1);
        const top = items[0];
        if (!top) continue;

        const prevId = this.lastSeenVideoId.get(id);
        this.lastSeenVideoId.set(id, top.videoId);

        // 初回チェック時 (ベースライン確立) は通知しない
        if (prevId === undefined) continue;
        if (prevId === top.videoId) continue;

        const title = `チャンネル新着: ${ch.myListName}`;
        const body = top.title;
        log.info(`new video detected: ${ch.myListName} → ${top.videoId} ${top.title}`);
        this.trayManager?.notify(title, body);
        if (getConfigStore().store.webhookNotify.enabled) {
          void sendWebhookNotify({
            title,
            description: body,
            level: 'success',
            videoId: top.videoId
          });
        }
      } catch (e) {
        log.warn(`channel watch failed: ${ch.myListName}`, e);
      }
    }
  }
}
