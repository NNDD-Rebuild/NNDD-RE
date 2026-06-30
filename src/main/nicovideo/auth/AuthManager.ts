import { BrowserWindow, safeStorage } from 'electron';
import { NicoApi } from '@shared/constants';
import type { AutoReloginResult } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { LoginWindow } from './LoginWindow';
import { NicoFormLoginClient, type FormLoginResult } from './NicoFormLoginClient';
import { getConfigStore } from '../../config/ConfigStore';
import { createLogger } from '../../util/Logger';

const log = createLogger('AuthManager');

/**
 * 認証高レベルAPI。
 * 元: nicovideo4as の Login.as, Niconicome-develop の Auth.cs
 */
export class AuthManager {
  private static _loggedOut = false;

  static get isLoggedOut(): boolean {
    return this._loggedOut;
  }

  /**
   * ログイン状態を確認 (保存済みCookieの有効性)。
   * Niconicome同様、トップページに HEAD/GET し、リダイレクト先で判断する。
   */
  static async checkLoggedIn(): Promise<boolean> {
    const ctx = NicoContext.get();
    if (!(await ctx.isLoggedIn())) return false;
    try {
      const res = await ctx.http.fetch(NicoApi.TOP, {
        method: 'GET',
        redirect: 'manual',
        noCookieReceive: true
      });
      // ログインしていれば 200、未ログインなら 302 で /login へ
      if (res.status === 200) return true;
      const loc = res.headers.get('location') ?? '';
      return !loc.includes('login');
    } catch (e) {
      log.warn('checkLoggedIn failed:', e);
      return false;
    }
  }

  /** ブラウザログインウィンドウを開いてCookieを取得 */
  static async login(parent?: BrowserWindow): Promise<boolean> {
    const ctx = NicoContext.get();
    return LoginWindow.openAndCaptureCookie(ctx.cookieStore, parent);
  }

  /**
   * メールアドレス/パスワードによるアプリ内ログイン。
   * 2段階認証が必要な場合は { mfaRequired: true, mfaSubmitUrl } を返す。
   */
  static async loginWithCredentials(
    email: string,
    password: string
  ): Promise<FormLoginResult> {
    const result = await NicoFormLoginClient.login(email, password);
    if (result.ok) this._loggedOut = false;
    return result;
  }

  /** MFAコード送信で認証完了 */
  static async completeMfa(
    mfaSubmitUrl: string,
    code: string
  ): Promise<FormLoginResult> {
    const result = await NicoFormLoginClient.completeMfa(mfaSubmitUrl, code);
    if (result.ok) this._loggedOut = false;
    return result;
  }

  /** メール/パスワードを OS セキュアストレージに保存 */
  static saveCredentials(email: string, password: string): { ok: boolean; error?: string } {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'OSのセキュアストレージが利用できません' };
    }
    try {
      const enc = safeStorage.encryptString(password).toString('base64');
      getConfigStore().set('auth', { savedEmail: email, savedPasswordEnc: enc });
      log.debug('credentials saved for:', email);
      return { ok: true };
    } catch (e) {
      log.warn('failed to save credentials:', e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 保存済み認証情報を削除 */
  static clearCredentials(): void {
    const store = getConfigStore();
    store.delete('auth.savedEmail' as never);
    store.delete('auth.savedPasswordEnc' as never);
    log.debug('credentials cleared');
  }

  /** 保存済み認証情報が存在するか */
  static hasCredentials(): boolean {
    const auth = getConfigStore().get('auth');
    return !!(auth.savedEmail && auth.savedPasswordEnc);
  }

  /** 保存済みメールアドレスを返す */
  static getSavedEmail(): string | null {
    return getConfigStore().get('auth').savedEmail ?? null;
  }

  /**
   * 起動時セッション確認 + 期限切れなら自動再ログイン。
   * MFAが必要な場合は { mfaRequired: true, mfaSubmitUrl } を返す (renderer側でMFA入力要求)。
   */
  static async autoRelogin(): Promise<AutoReloginResult> {
    if (await this.checkLoggedIn()) return { ok: true };

    const auth = getConfigStore().get('auth');
    const email = auth.savedEmail;
    const enc = auth.savedPasswordEnc;
    if (!email || !enc) return { ok: false, noCredentials: true };

    let password: string;
    try {
      password = safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (e) {
      log.warn('failed to decrypt saved password:', e);
      this.clearCredentials();
      return { ok: false, error: '保存済みパスワードの復号に失敗しました' };
    }

    log.debug('auto relogin for:', email);
    try {
      const result = await NicoFormLoginClient.login(email, password);
      if (result.ok) {
        this._loggedOut = false;
        return { ok: true };
      }
      if (result.mfaRequired && result.mfaSubmitUrl) {
        return { ok: false, mfaRequired: true, mfaSubmitUrl: result.mfaSubmitUrl };
      }
      // パスワード変更等でログイン失敗 → 保存情報をクリアして無限ループ防止
      log.warn('auto relogin failed, clearing credentials:', result.error);
      this.clearCredentials();
      return { ok: false, error: result.error ?? 'ログインに失敗しました' };
    } catch (e) {
      log.warn('auto relogin error:', e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 保存済み認証情報でログイン (モーダルから呼ばれる) */
  static async loginWithSavedCredentials(): Promise<FormLoginResult> {
    const auth = getConfigStore().get('auth');
    const email = auth.savedEmail;
    const enc = auth.savedPasswordEnc;
    if (!email || !enc) {
      return { ok: false, error: '保存済みの認証情報がありません' };
    }
    let password: string;
    try {
      password = safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (e) {
      log.warn('failed to decrypt saved password:', e);
      this.clearCredentials();
      return { ok: false, error: '保存済みパスワードの復号に失敗しました' };
    }
    const result = await NicoFormLoginClient.login(email, password);
    if (result.ok) this._loggedOut = false;
    return result;
  }

  /** ログアウト (Cookieを全クリア) */
  static async logout(): Promise<void> {
    const ctx = NicoContext.get();
    try {
      // サーバー側にも通知 (失敗してもCookie破棄は続行)
      await ctx.http.fetch(NicoApi.LOGOUT, {
        method: 'GET',
        redirect: 'manual'
      });
    } catch (e) {
      log.warn('Server logout failed (ignored):', e);
    }
    await ctx.cookieStore.clear();
    this._loggedOut = true;
  }
}
