import { Client } from '@xhayper/discord-rpc';
import { createLogger } from '../util/Logger';
import { getConfigStore } from '../config/ConfigStore';
import { NicoApi } from '@shared/constants';
import type { DiscordActivityInfo } from '@shared/types';

const log = createLogger('DiscordRpc');
/** Discord Developer Portal で発行したNNDD-RE用アプリのClient ID (公開情報。RPC接続のみでClient Secretは使わない) */
const DISCORD_CLIENT_ID = '1529880212769214575';
const GITHUB_REPO_URL = 'https://github.com/NNDD-Rebuild/NNDD-RE';
/** ニコニコ動画IDのパターン。ローカル専用ファイル (LANライブラリ等) はIDが取れないため判定して弾く */
const VIDEO_ID_PATTERN = /^(?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+$/;

/**
 * Discord Rich Presence 連携。
 * ローカルのDiscordクライアント (IPCソケット) に接続してPresenceを更新する。
 * Discordが起動していない場合は接続に失敗するが、致命的エラーとはせず警告ログのみ出す。
 */
class DiscordRpcManagerImpl {
  private client: Client | null = null;
  private connectedClientId = '';
  private connecting: Promise<boolean> | null = null;

  private async ensureConnected(clientId: string): Promise<boolean> {
    if (this.client?.isConnected && this.connectedClientId === clientId) {
      return true;
    }
    if (this.connectedClientId !== clientId) {
      await this.disconnect();
    }
    if (this.connecting) return this.connecting;

    this.connecting = (async (): Promise<boolean> => {
      try {
        const client = new Client({ clientId });
        await client.login();
        this.client = client;
        this.connectedClientId = clientId;
        log.info('connected');
        return true;
      } catch (e) {
        log.warn('connect failed (Discordが起動していない可能性があります):', e);
        this.client = null;
        this.connectedClientId = '';
        return false;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connectedClientId = '';
    if (client) {
      try {
        await client.destroy();
      } catch (e) {
        log.warn('disconnect error:', e);
      }
    }
  }

  async setActivity(info: DiscordActivityInfo): Promise<void> {
    const cfg = getConfigStore().store.discordRpc;
    if (!cfg.enabled || !DISCORD_CLIENT_ID) return;
    const ok = await this.ensureConnected(DISCORD_CLIENT_ID);
    if (!ok || !this.client) return;

    const endTimestamp =
      cfg.showElapsed && info.durationSec
        ? info.startedAtMs + info.durationSec * 1000
        : undefined;

    const buttons: { label: string; url: string }[] = [];
    if (VIDEO_ID_PATTERN.test(info.videoId)) {
      buttons.push({ label: '動画を見る', url: `${NicoApi.WATCH_PAGE}${info.videoId}` });
    }
    if (cfg.showGithubButton) {
      buttons.push({ label: 'GitHub', url: GITHUB_REPO_URL });
    }

    try {
      await this.client.user?.setActivity({
        details: cfg.showTitle ? info.title.slice(0, 128) : 'NNDD-REで視聴中',
        state: 'NNDD-REで視聴中',
        startTimestamp: cfg.showElapsed ? info.startedAtMs : undefined,
        endTimestamp,
        largeImageKey: cfg.showThumbnail ? info.thumbnailUrl : undefined,
        largeImageText: cfg.showThumbnail ? info.title.slice(0, 128) : undefined,
        buttons: buttons.length > 0 ? buttons : undefined,
        instance: false
      });
    } catch (e) {
      log.warn('setActivity failed:', e);
    }
  }

  async clearActivity(): Promise<void> {
    if (!this.client?.isConnected) return;
    try {
      await this.client.user?.clearActivity();
    } catch (e) {
      log.warn('clearActivity failed:', e);
    }
  }

  /** 設定変更時に呼ぶ。無効化された場合は切断する */
  async onConfigChanged(): Promise<void> {
    if (!getConfigStore().store.discordRpc.enabled) {
      await this.disconnect();
    }
  }

  status(): { connected: boolean } {
    return { connected: Boolean(this.client?.isConnected) };
  }
}

let instance: DiscordRpcManagerImpl | null = null;

export function getDiscordRpcManager(): DiscordRpcManagerImpl {
  if (!instance) instance = new DiscordRpcManagerImpl();
  return instance;
}
