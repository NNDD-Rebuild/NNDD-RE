import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage, type Session } from 'electron';
import { NicoMfaTrust, NnddPaths } from '@shared/constants';
import { createLogger } from '../../util/Logger';

const log = createLogger('MfaTrustStore');

interface TrustEntry {
  /** safeStorage で暗号化したトークン (base64) */
  enc: string;
  /** 有効期限 (UNIX 秒)。無期限/不明は省略 */
  expirationDate?: number;
}

/**
 * 2段階認証の信頼済みデバイストークン (`__Host-mfa_trusted_device_token`) をアカウント別に保存する。
 *
 * ログインウィンドウの partition はログインのたびに消去する (前回セッションでの素通り防止) ため、
 * 信頼トークンも消えて毎回「新しい端末」として 2段階認証と端末登録が走ってしまう。
 * そこでトークンだけをアカウント (メールアドレス) 別に退避し、同じアカウントで ID/Pass ログインするときだけ
 * partition へ書き戻す。別アカウントには引き継がない。
 */
export class MfaTrustStore {
  private static filePath(): string {
    return path.join(app.getPath('userData'), NnddPaths.MFA_TRUST_FILE_NAME);
  }

  private static key(email: string): string {
    return email.trim().toLowerCase();
  }

  private static load(): Record<string, TrustEntry> {
    try {
      const file = this.filePath();
      if (!fs.existsSync(file)) return {};
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, TrustEntry>;
    } catch (e) {
      log.warn('Failed to load trust store:', e);
      return {};
    }
  }

  private static write(data: Record<string, TrustEntry>): void {
    const file = this.filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  }

  /** 保存済みトークンを partition へ書き戻す。該当アカウントの保存が無い/期限切れなら何もしない */
  static async restoreToSession(ses: Session, email: string): Promise<boolean> {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const entry = this.load()[this.key(email)];
    if (!entry) return false;
    if (entry.expirationDate && entry.expirationDate * 1000 <= Date.now()) return false;
    try {
      const value = safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
      // domain を指定しない = ホスト限定 Cookie (`__Host-` 接頭辞の要件: Secure / Path=/ / Domain なし)
      await ses.cookies.set({
        url: NicoMfaTrust.URL,
        name: NicoMfaTrust.COOKIE_NAME,
        value,
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: entry.expirationDate
      });
      log.info('MFA trust token restored');
      return true;
    } catch (e) {
      log.warn('Failed to restore MFA trust token:', e);
      return false;
    }
  }

  /**
   * partition 内の信頼トークンを該当アカウントの分として保存する。
   * 2段階認証を通した直後は Cookie が user_session より遅れて入る可能性があるため、
   * waitMs の間だけ出現を待つ。
   */
  static async captureFromSession(ses: Session, email: string, waitMs = 0): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const find = async (): Promise<Electron.Cookie | undefined> =>
        (await ses.cookies.get({ url: NicoMfaTrust.URL, name: NicoMfaTrust.COOKIE_NAME }))[0];
      let cookie = await find();
      for (let waited = 0; !cookie && waited < waitMs; waited += 250) {
        await new Promise((r) => setTimeout(r, 250));
        cookie = await find();
      }
      if (!cookie) return;
      const data = this.load();
      data[this.key(email)] = {
        enc: safeStorage.encryptString(cookie.value).toString('base64'),
        expirationDate: cookie.expirationDate
      };
      this.write(data);
      log.info('MFA trust token saved');
    } catch (e) {
      log.warn('Failed to save MFA trust token:', e);
    }
  }
}
