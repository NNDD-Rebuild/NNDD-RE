import { Client } from '@xhayper/discord-rpc';
import { createLogger } from '../util/Logger';
import { getConfigStore } from '../config/ConfigStore';
import { liveWatchUrl, watchUrl } from '@shared/utils/nicoUrl';
import type { DiscordActivityInfo } from '@shared/types';

const log = createLogger('DiscordRpc');
/** Discord Developer Portal で発行したNNDD-RE用アプリのClient ID (公開情報。RPC接続のみでClient Secretは使わない) */
const DISCORD_CLIENT_ID = '1529880212769214575';
const GITHUB_REPO_URL = 'https://github.com/NNDD-Rebuild/NNDD-RE';
/** ニコニコ動画IDのパターン。ローカル専用ファイル (LANライブラリ等) はIDが取れないため判定して弾く */
const VIDEO_ID_PATTERN = /^(?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+$/;
const LIVE_ID_PATTERN = /^lv\d+$/;

/**
 * Discord Rich Presence 連携。
 * ローカルのDiscordクライアント (IPCソケット) に接続してPresenceを更新する。
 * Discordが起動していない場合は接続に失敗するが、致命的エラーとはせず警告ログのみ出す。
 */
class DiscordRpcManagerImpl {
  private client: Client | null = null;
  private connectedClientId = '';
  private connecting: Promise<boolean> | null = null;
  /** 設定変更時に再送するため、最後に送ったPresence情報を保持する */
  private lastInfo: DiscordActivityInfo | null = null;
  /** 現在のPresenceを送ったプレイヤーウィンドウ (webContents.id)。複数ウィンドウで別ウィンドウの表示を消さないために使う */
  private ownerId: number | null = null;

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

  async setActivity(info: DiscordActivityInfo, ownerId?: number): Promise<void> {
    this.lastInfo = info;
    this.ownerId = ownerId ?? null;
    const cfg = getConfigStore().store.discordRpc;
    if (!cfg.enabled || !DISCORD_CLIENT_ID) return;
    const ok = await this.ensureConnected(DISCORD_CLIENT_ID);
    if (!ok || !this.client) return;

    const endTimestamp = info.durationSec
      ? info.startedAtMs + info.durationSec * 1000
      : undefined;

    const isLive = info.kind === 'live' || info.kind === 'timeshift';
    const stateText =
      info.kind === 'live' ? 'NNDD-REで生放送を視聴中' : info.kind === 'timeshift' ? 'NNDD-REでタイムシフトを視聴中' : 'NNDD-REで視聴中';

    const buttons: { label: string; url: string }[] = [];
    if (isLive) {
      if (LIVE_ID_PATTERN.test(info.videoId)) {
        buttons.push({ label: '生放送を見る', url: liveWatchUrl(info.videoId) });
      }
    } else if (VIDEO_ID_PATTERN.test(info.videoId)) {
      buttons.push({ label: '動画を見る', url: watchUrl(info.videoId) });
    }
    if (cfg.showGithubButton) {
      buttons.push({ label: 'GitHub', url: GITHUB_REPO_URL });
    }

    try {
      await this.client.user?.setActivity({
        details: cfg.showTitle ? info.title.slice(0, 128) : stateText,
        state: stateText,
        startTimestamp: info.startedAtMs,
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

  /** ownerId 指定時は、そのウィンドウが送ったPresenceのときだけクリアする */
  async clearActivity(ownerId?: number): Promise<void> {
    if (ownerId !== undefined && this.ownerId !== null && this.ownerId !== ownerId) return;
    this.lastInfo = null;
    this.ownerId = null;
    if (!this.client?.isConnected) return;
    try {
      await this.client.user?.clearActivity();
    } catch (e) {
      log.warn('clearActivity failed:', e);
    }
  }

  /** 設定変更時に呼ぶ。無効化された場合は切断し、それ以外は再生中のPresenceを新しい設定で送り直す */
  async onConfigChanged(): Promise<void> {
    if (!getConfigStore().store.discordRpc.enabled) {
      await this.disconnect();
      return;
    }
    if (this.lastInfo) await this.setActivity(this.lastInfo);
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
