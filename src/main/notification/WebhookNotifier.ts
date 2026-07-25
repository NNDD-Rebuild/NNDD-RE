import { createLogger } from '../util/Logger';
import { getConfigStore } from '../config/ConfigStore';
import { NicoApi } from '@shared/constants';

const log = createLogger('WebhookNotifier');

export type WebhookProvider = 'discord' | 'slack';

export interface WebhookNotifyPayload {
  /** 通知タイトル (例: 「ダウンロード完了」) */
  title: string;
  /** 動画タイトル等の本文 */
  description: string;
  /** 成功=緑 / 失敗=赤 などUI上の色分けヒント */
  level: 'success' | 'error';
  videoId?: string;
}

const DISCORD_COLOR = { success: 0x57f287, error: 0xed4245 } as const;

/** webhookUrlのホスト名からDiscord/Slackを自動判定する */
export function detectWebhookProvider(webhookUrl: string): WebhookProvider | null {
  let hostname: string;
  try {
    hostname = new URL(webhookUrl).hostname;
  } catch {
    return null;
  }
  if (hostname.endsWith('discord.com') || hostname.endsWith('discordapp.com')) return 'discord';
  if (hostname.endsWith('slack.com')) return 'slack';
  return null;
}

function buildDiscordBody(payload: WebhookNotifyPayload): unknown {
  const url = payload.videoId ? `${NicoApi.WATCH_PAGE}${payload.videoId}` : undefined;
  return {
    embeds: [
      {
        title: payload.title,
        description: payload.description,
        url,
        color: DISCORD_COLOR[payload.level]
      }
    ]
  };
}

function buildSlackBody(payload: WebhookNotifyPayload): unknown {
  const url = payload.videoId ? `${NicoApi.WATCH_PAGE}${payload.videoId}` : undefined;
  const text = url ? `*${payload.title}*\n${payload.description}\n${url}` : `*${payload.title}*\n${payload.description}`;
  return { text };
}

/**
 * DiscordまたはSlackのIncoming Webhookへ通知を送る。
 * webhookUrlのホスト名から送信先を自動判定し、それぞれのペイロード形式でPOSTする。
 */
export async function sendWebhookNotify(payload: WebhookNotifyPayload): Promise<void> {
  const cfg = getConfigStore().store.webhookNotify;
  if (!cfg.enabled || !cfg.webhookUrl) return;

  const provider = detectWebhookProvider(cfg.webhookUrl);
  if (!provider) {
    log.warn('未対応のWebhook URL (Discord/Slack以外):', cfg.webhookUrl);
    return;
  }

  const body = provider === 'discord' ? buildDiscordBody(payload) : buildSlackBody(payload);

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      log.warn(`Webhook送信失敗 (${provider}): status=${res.status}`);
    }
  } catch (e) {
    log.warn(`Webhook送信エラー (${provider}):`, e);
  }
}
