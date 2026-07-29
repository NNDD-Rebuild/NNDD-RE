import { BrowserWindow, safeStorage } from 'electron';
import { NicoApi } from '@shared/constants';
import type { AutoReloginResult } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { LoginWindow, type SsoProvider } from './LoginWindow';
import { ApiLoginClient } from './ApiLoginClient';
import { getConfigStore } from '../../config/ConfigStore';
import { createLogger } from '../../util/Logger';

const log = createLogger('AuthManager');

/**
 * ID/Pass ログインの結果。
 * 2FA は LoginWindow (実ブラウザ) 上でユーザーが完結させるため、mfaRequired/mfaSubmitUrl は
 * 現在使用しない (IPC/renderer 型互換のためフィールドは残す)。
 */
export interface FormLoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
  error?: string;
  blocked?: boolean;
}

/** サイレント自動再ログイン (隠しウィンドウ) のタイムアウト */
const SILENT_RELOGIN_TIMEOUT_MS = 15000;

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
   *
   * トップページ (NicoApi.TOP) は未ログインでも 200 を返すため、
   * それでの判定は「実際はセッションが切れているのにログイン中と誤判定し続ける」
   * バグを生む (起動時にセッション切れを検知できず、自動再ログインが発動しない)。
   * 代わりにログイン必須の実APIを叩き、ステータスコードで判定する。
   * ここで受け取る Set-Cookie は破棄しない (user_session 延長の恩恵を受ける)。
   */
  static async checkLoggedIn(): Promise<boolean> {
    const ctx = NicoContext.get();
    if (!(await ctx.isLoggedIn())) return false;
    try {
      const res = await ctx.http.fetch(NicoApi.MYLIST_API_BASE);
      return res.status === 200;
    } catch (e) {
      log.warn('checkLoggedIn failed:', e);
      return false;
    }
  }

  /**
   * ブラウザログインウィンドウを開いてCookieを取得。
   * ssoProvider 指定時は Apple/Google/LINE/X/Facebook ボタンを自動クリックする。
   */
  static async login(parent?: BrowserWindow, ssoProvider?: SsoProvider): Promise<boolean> {
    const ctx = NicoContext.get();
    return LoginWindow.openAndCaptureCookie(ctx.cookieStore, { parent, ssoProvider });
  }

  /**
   * メールアドレス/パスワードによるアプリ内ログイン (3段フォールバック)。
   *  ①API直叩き (v1, 無音・高速。IPクリーン時のみ通る)
   *  → ブロック/判定不能時 ②隠しログインウィンドウ (managed Turnstile 自動解決狙い)
   *  → 失敗時 ③ログインウィンドウ表示 (ユーザーが Turnstile/2FA を解く)
   * ID/Pass が明確に誤り(wrongCreds)なら②③に進まず即エラーを返す。
   * MFA 要求なら①②を飛ばして③(表示ウィンドウ)でユーザーに解かせる。
   */
  static async loginWithCredentials(
    email: string,
    password: string,
    parent?: BrowserWindow
  ): Promise<FormLoginResult> {
    // ① API 直叩き (fast path)
    const api = await ApiLoginClient.login(email, password);
    if (api.status === 'ok') {
      this._loggedOut = false;
      return { ok: true };
    }
    if (api.status === 'wrongCreds') {
      return { ok: false, error: 'メールアドレスまたはパスワードが正しくありません' };
    }
    // mfa / blocked → ウィンドウ方式へ
    log.debug('api login fell through:', api.status);

    const credentials = { email, password };

    // ② 隠しウィンドウ (MFA要求時はユーザー操作が要るので飛ばして③へ)
    if (api.status !== 'mfa') {
      const hiddenOk = await this.tryLoginWindow(credentials, { show: false });
      if (hiddenOk) return { ok: true };
    }

    // ③ 表示ウィンドウ (Turnstile/2FA をユーザーが解く)
    const visibleOk = await this.tryLoginWindow(credentials, { show: true, parent });
    if (visibleOk) return { ok: true };
    return { ok: false, error: 'ログインがキャンセルされたか、完了しませんでした' };
  }

  /** LoginWindow でログイン試行し、成功なら _loggedOut を下ろす共通ヘルパ */
  private static async tryLoginWindow(
    credentials: { email: string; password: string },
    opts: { show: boolean; parent?: BrowserWindow }
  ): Promise<boolean> {
    const ctx = NicoContext.get();
    const ok = await LoginWindow.openAndCaptureCookie(ctx.cookieStore, {
      credentials,
      show: opts.show,
      parent: opts.parent,
      timeoutMs: opts.show ? undefined : SILENT_RELOGIN_TIMEOUT_MS
    });
    if (ok) this._loggedOut = false;
    return ok;
  }

  /**
   * (廃止) MFAコード送信。2FA は LoginWindow 上で完結するため呼ばれない。
   * IPC 互換のため残置。
   */
  static async completeMfa(
    _mfaSubmitUrl: string,
    _code: string
  ): Promise<FormLoginResult> {
    return { ok: false, error: 'この認証方式は廃止されました。ログインし直してください' };
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
      // 起動時は無音優先: ①API直叩き → ②隠しウィンドウ まで。
      // ③表示ウィンドウは起動時に勝手に出さない (失敗時は期限切れ通知経由で
      // ユーザーが手動ログイン→表示ウィンドウまで進める)。
      const api = await ApiLoginClient.login(email, password);
      if (api.status === 'ok') {
        this._loggedOut = false;
        return { ok: true };
      }
      if (api.status === 'wrongCreds') {
        // 保存パスワードが実際に無効 (変更された等) → クリアして無限ループ防止
        log.warn('auto relogin wrong credentials, clearing');
        this.clearCredentials();
        return { ok: false, error: 'メールアドレスまたはパスワードが正しくありません' };
      }

      // blocked / mfa → 隠しウィンドウでサイレント試行 (managed Turnstile 自動解決狙い)
      if (api.status !== 'mfa') {
        const hiddenOk = await this.tryLoginWindow({ email, password }, { show: false });
        if (hiddenOk) return { ok: true };
      }

      // サイレント失敗は ID/Pass 誤りと断定できない (Turnstile/2FA 要求の可能性) ため
      // 保存情報は消さず、ユーザーの手動ログインに委ねる。
      log.warn('silent auto relogin did not complete (credentials kept)');
      return { ok: false, error: '自動ログインに失敗しました。手動でログインしてください' };
    } catch (e) {
      log.warn('auto relogin error:', e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 保存済み認証情報でログイン (モーダルから呼ばれる。実ブラウザウィンドウを表示) */
  static async loginWithSavedCredentials(parent?: BrowserWindow): Promise<FormLoginResult> {
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
    return this.loginWithCredentials(email, password, parent);
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
