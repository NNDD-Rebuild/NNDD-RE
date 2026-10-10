import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, safeStorage } from 'electron';
import { createLogger } from '../util/Logger';

const log = createLogger('SecretStore');

const FILE_NAME = 'nndd-http-secrets.json';
/** safeStorage が使えない環境で平文保存した値の目印 */
const PLAIN_PREFIX = 'plain:';

type SecretName = 'httpAccessToken' | 'remoteNnddToken' | 'tailscaleAuthKey';

/**
 * HTTP アクセストークン等の秘密情報の保管庫。
 *
 * ConfigStore (electron-store) には置かない。httpServer / remoteNndd は GitHub Gist バックアップの
 * 同期対象 (BackupManager.SYNCABLE_CONFIG_KEYS) で、トークンが外部へ送られてしまうため。
 * userData 配下の専用ファイルに safeStorage で暗号化して保存する。
 */
export class SecretStore {
  private static filePath(): string {
    return path.join(app.getPath('userData'), FILE_NAME);
  }

  private static load(): Partial<Record<SecretName, string>> {
    try {
      const file = this.filePath();
      if (!fs.existsSync(file)) return {};
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Record<SecretName, string>>;
    } catch (e) {
      log.warn('Failed to load secrets:', e);
      return {};
    }
  }

  private static write(data: Partial<Record<SecretName, string>>): void {
    const file = this.filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 他ユーザーから読めないようにする (Windows では無視される)
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  static get(name: SecretName): string | null {
    const stored = this.load()[name];
    if (!stored) return null;
    if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (e) {
      log.warn(`Failed to decrypt secret ${name}:`, e);
      return null;
    }
  }

  static set(name: SecretName, value: string): void {
    const data = this.load();
    if (safeStorage.isEncryptionAvailable()) {
      data[name] = safeStorage.encryptString(value).toString('base64');
    } else {
      log.warn(`safeStorage is unavailable: storing ${name} without OS encryption`);
      data[name] = PLAIN_PREFIX + value;
    }
    this.write(data);
  }

  static delete(name: SecretName): void {
    const data = this.load();
    if (!(name in data)) return;
    delete data[name];
    this.write(data);
  }

  /** 内蔵 HTTP サーバーのアクセストークン。未生成なら作る */
  static getOrCreateAccessToken(): string {
    const existing = this.get('httpAccessToken');
    if (existing) return existing;
    return this.regenerateAccessToken();
  }

  /** アクセストークンを作り直す (旧トークンは即無効) */
  static regenerateAccessToken(): string {
    const token = crypto.randomBytes(24).toString('base64url');
    this.set('httpAccessToken', token);
    return token;
  }
}
