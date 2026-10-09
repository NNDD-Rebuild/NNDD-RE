import { BrowserWindow, safeStorage, session } from 'electron';
import { NicoApi, NicoEndpoint } from '@shared/constants';
import type { AutoReloginResult } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { LoginWindow, type SsoProvider } from './LoginWindow';
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

  private static mfaNotifier: ((payload: { error?: string }) => void) | null = null;
  private static pendingMfa: ((code: string | null) => void) | null = null;
  private static autoReloginInFlight: Promise<AutoReloginResult> | null = null;

  /** renderer への2FAコード要求通知先を登録 (メインウィンドウ生成後に呼ぶ) */
  static setMfaNotifier(fn: (payload: { error?: string }) => void): void {
    this.mfaNotifier = fn;
  }

  /** renderer のフォームからコードを受け取る。キャンセル/通知先なしは null */
  private static requestMfaCode(error?: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.mfaNotifier) return resolve(null);
      this.pendingMfa?.(null);
      this.pendingMfa = resolve;
      this.mfaNotifier({ error });
    });
  }

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
      const res = await ctx.http.fetch(NicoEndpoint.myMylists());
      return res.status === 200;
    } catch (e) {
      log.warn('checkLoggedIn failed:', e);
      return false;
    }
  }

  /**
   * ブラウザログインウィンドウを開いてCookieを取得。
   * ssoProvider 指定時は Apple/Google/LINE/X/Facebook ボタンを自動クリックする。
   *
   * LoginWindow は永続化された partition ('persist:nndd-login') を使うため、
   * 前回ログイン時の Cookie が残ったままだとニコニコ側で既ログイン扱いとなり、
   * フォーム入力なしに素通りしてしまう (=保存パスワードでの自動ログインに見える)。
   * ここで毎回クリアし、アプリ内の保存パスワード/通常セッションとは独立した
   * まっさらな状態からブラウザログインを開始させる。
   * 2段階認証の信頼トークンも消えるが、どのアカウントでログインするか不明なため
   * ここでは復元しない (ID/Pass ログインは LoginWindow 側でアカウント別に復元する)。
   */
  static async login(parent?: BrowserWindow, ssoProvider?: SsoProvider): Promise<boolean> {
    const ctx = NicoContext.get();
    await session.fromPartition('persist:nndd-login').clearStorageData();
    return LoginWindow.openAndCaptureCookie(ctx.cookieStore, { parent, ssoProvider });
  }

  /**
   * メールアドレス/パスワードによるアプリ内ログイン (2段フォールバック)。
   * ログインは Cloudflare Turnstile 保護の SPA でトークンが必須のため、API直叩きは行わない。
   *  ① 隠しログインウィンドウ (managed Turnstile 自動解決狙い。2FA はアプリ内フォームで入力)
   *  → 失敗時 ② ログインウィンドウ表示 (ユーザーが Turnstile/2FA を解く)
   */
  static async loginWithCredentials(
    email: string,
    password: string,
    parent?: BrowserWindow
  ): Promise<FormLoginResult> {
    const credentials = { email, password };
    const requestMfaCode = (error?: string): Promise<string | null> => this.requestMfaCode(error);

    const hiddenOk = await this.tryLoginWindow(credentials, { show: false, requestMfaCode });
    if (hiddenOk) return { ok: true };

    const visibleOk = await this.tryLoginWindow(credentials, {
      show: true,
      parent,
      requestMfaCode
    });
    if (visibleOk) return { ok: true };
    return { ok: false, error: 'ログインがキャンセルされたか、完了しませんでした' };
  }

  /** LoginWindow でログイン試行し、成功なら _loggedOut を下ろす共通ヘルパ */
  private static async tryLoginWindow(
    credentials: { email: string; password: string },
    opts: {
      show: boolean;
      parent?: BrowserWindow;
      requestMfaCode?: (error?: string) => Promise<string | null>;
    }
  ): Promise<boolean> {
    const ctx = NicoContext.get();
    const ok = await LoginWindow.openAndCaptureCookie(ctx.cookieStore, {
      credentials,
      show: opts.show,
      parent: opts.parent,
      timeoutMs: opts.show ? undefined : SILENT_RELOGIN_TIMEOUT_MS,
      requestMfaCode: opts.requestMfaCode
    });
    if (ok) this._loggedOut = false;
    return ok;
  }

  /**
   * 2段階認証コードをログインウィンドウへ渡す (空文字=キャンセル)。
   * 戻り値は「受理した」ことのみを表し、ログイン完了は元の loginWithCredentials の結果で通知される。
   */
  static async completeMfa(_mfaSubmitUrl: string, code: string): Promise<FormLoginResult> {
    const pending = this.pendingMfa;
    if (!pending) return { ok: false, error: '2段階認証の待機中ではありません' };
    this.pendingMfa = null;
    pending(code ? code : null);
    return { ok: true };
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
  static autoRelogin(): Promise<AutoReloginResult> {
    // 起動時などに複数経路から同時に呼ばれると、同じ partition を奪い合い (消去/復元が競合) 、
    // 2段階認証や端末登録も重複するため、実行中の1本に相乗りさせる
    if (!this.autoReloginInFlight) {
      this.autoReloginInFlight = this.doAutoRelogin().finally(() => {
        this.autoReloginInFlight = null;
      });
    }
    return this.autoReloginInFlight;
  }

  private static async doAutoRelogin(): Promise<AutoReloginResult> {
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
      // 起動時は無音優先: 隠しウィンドウのみ。表示ウィンドウは起動時に勝手に出さない
      // (失敗時は期限切れ通知経由でユーザーが手動ログインに進む)。
      const hiddenOk = await this.tryLoginWindow({ email, password }, { show: false });
      if (hiddenOk) return { ok: true };

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

  /**
   * ログアウト (Cookieを全クリア)。
   * 2段階認証の信頼トークン (MfaTrustStore) は消さない。再ログイン時に毎回 2段階認証を
   * 求められないようにするため。信頼の取り消しはニコニコ側の「信頼済みデバイス」で行う。
   */
  static async logout(): Promise<void> {
    const ctx = NicoContext.get();
    try {
      // サーバー側にも通知 (失敗してもCookie破棄は続行)
      const res = await ctx.http.fetch(NicoApi.LOGOUT, {
        method: 'DELETE',
        headers: {
          Origin: NicoApi.ACCOUNT_BASE,
          Referer: `${NicoApi.ACCOUNT_BASE}/`,
          'X-Frontend-Id': NicoApi.ACCOUNT_FRONTEND_ID,
          'X-Frontend-Version': NicoApi.ACCOUNT_FRONTEND_VERSION
        }
      });
      log.debug('server logout status:', res.status);
    } catch (e) {
      log.warn('Server logout failed (ignored):', e);
    }
    await ctx.cookieStore.clear();
    this._loggedOut = true;
  }
}
