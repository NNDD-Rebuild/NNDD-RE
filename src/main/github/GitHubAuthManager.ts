import { EventEmitter } from 'node:events';
import { safeStorage, shell } from 'electron';
import { GitHubApi } from '@shared/constants';
import type { DeviceFlowEvent, DeviceFlowStartResult, GitHubStatus } from '@shared/types';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';
import { DeviceFlowAuth } from './DeviceFlowAuth';

const log = createLogger('GitHubAuthManager');

class GitHubAuthEvents extends EventEmitter {}

/**
 * GitHub OAuth Device Flow 認証の高レベルAPI。
 * 元: nicovideo/auth/AuthManager.ts と同様のパターン (safeStorage で暗号化してConfigStoreに永続化)。
 */
export class GitHubAuthManager {
  /** Device Flow の進捗を通知するイベントバス ('event' -> DeviceFlowEvent) */
  static readonly events: EventEmitter = new GitHubAuthEvents();

  private static pollTimer: NodeJS.Timeout | null = null;
  private static cancelled = false;

  static async status(): Promise<GitHubStatus> {
    const cfg = getConfigStore().get('githubSync');
    if (!cfg.accessTokenEnc) return { loggedIn: false };
    return { loggedIn: true, username: cfg.username };
  }

  /** 復号済みアクセストークンを取得 (GistClient 用) */
  static getToken(): string | null {
    const cfg = getConfigStore().get('githubSync');
    if (!cfg.accessTokenEnc) return null;
    try {
      return safeStorage.decryptString(Buffer.from(cfg.accessTokenEnc, 'base64'));
    } catch (e) {
      log.warn('failed to decrypt access token:', e);
      return null;
    }
  }

  /** Device Flow を開始し、デバイスコード取得後に検証用ブラウザを開く。以降はバックグラウンドでポーリング。 */
  static async startDeviceFlow(): Promise<DeviceFlowStartResult | { error: string }> {
    if (!GitHubApi.CLIENT_ID) {
      return { error: 'GitHub OAuth AppのClient IDが設定されていません (開発者による設定が必要です)' };
    }
    // 前回のポーリングが残っていればキャンセル
    this.cancelDeviceFlow();
    this.cancelled = false;

    let device;
    try {
      device = await DeviceFlowAuth.requestDeviceCode();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn('requestDeviceCode failed:', message);
      return { error: message };
    }

    shell.openExternal(device.verificationUri).catch((e) => {
      log.warn('failed to open external browser:', e);
    });

    this.schedulePoll(device.deviceCode, device.interval, Date.now() + device.expiresIn * 1000);

    return {
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      expiresIn: device.expiresIn
    };
  }

  static cancelDeviceFlow(): void {
    this.cancelled = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private static schedulePoll(deviceCode: string, intervalSec: number, deadline: number): void {
    let interval = intervalSec;

    const tick = async (): Promise<void> => {
      if (this.cancelled) return;
      if (Date.now() > deadline) {
        this.events.emit('event', {
          status: 'expired',
          message: '認証コードの有効期限が切れました'
        } satisfies DeviceFlowEvent);
        return;
      }

      let result;
      try {
        result = await DeviceFlowAuth.pollAccessToken(deviceCode);
      } catch (e) {
        this.events.emit('event', {
          status: 'error',
          message: e instanceof Error ? e.message : String(e)
        } satisfies DeviceFlowEvent);
        return;
      }
      if (this.cancelled) return;

      if (result.ok) {
        const username = await DeviceFlowAuth.fetchUsername(result.accessToken);
        try {
          this.saveToken(result.accessToken, username);
        } catch (e) {
          this.events.emit('event', {
            status: 'error',
            message: e instanceof Error ? e.message : String(e)
          } satisfies DeviceFlowEvent);
          return;
        }
        this.events.emit('event', { status: 'success', username } satisfies DeviceFlowEvent);
        return;
      }

      switch (result.error) {
        case 'authorization_pending':
          this.pollTimer = setTimeout(tick, interval * 1000);
          return;
        case 'slow_down':
          interval += 5;
          this.pollTimer = setTimeout(tick, interval * 1000);
          return;
        case 'expired_token':
          this.events.emit('event', {
            status: 'expired',
            message: '認証コードの有効期限が切れました'
          } satisfies DeviceFlowEvent);
          return;
        case 'access_denied':
          this.events.emit('event', {
            status: 'denied',
            message: '認証がキャンセルされました'
          } satisfies DeviceFlowEvent);
          return;
        default:
          this.events.emit('event', {
            status: 'error',
            message: result.error
          } satisfies DeviceFlowEvent);
          return;
      }
    };

    this.pollTimer = setTimeout(tick, interval * 1000);
  }

  private static saveToken(accessToken: string, username: string | undefined): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OSのセキュアストレージが利用できません');
    }
    const enc = safeStorage.encryptString(accessToken).toString('base64');
    const cfg = getConfigStore().get('githubSync');
    getConfigStore().set('githubSync', { ...cfg, accessTokenEnc: enc, username });
    log.debug('access token saved for:', username);
  }

  static logout(): void {
    const cfg = getConfigStore().get('githubSync');
    getConfigStore().set('githubSync', {
      ...cfg,
      accessTokenEnc: undefined,
      username: undefined
    });
    log.debug('logged out');
  }
}
