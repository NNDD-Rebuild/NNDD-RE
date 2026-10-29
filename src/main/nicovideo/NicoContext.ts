import { CookieStore } from './auth/CookieStore';
import { accountCookiePath, anonymousCookiePath, legacyCookiePath } from './auth/accountPaths';
import { getConfigStore } from '../config/ConfigStore';
import { NicoHttp } from './NicoHttp';

/**
 * ニコニコAPIアクセス用のシングルトンコンテキスト。
 * CookieStore と NicoHttp を 1セットでまとめて、各API呼び出しから共有する。
 *
 * 元: Niconicome-develop の NiconicoContext.cs に相当
 */
export class NicoContext {
  private static _instance: NicoContext | null = null;

  private constructor(
    readonly cookieStore: CookieStore,
    readonly http: NicoHttp
  ) {}

  static async initialize(): Promise<NicoContext> {
    if (this._instance) return this._instance;
    // 最後に使ったアカウントの Cookie を復元。アカウント未登録 (旧バージョンからの移行前) は旧 cookies.json
    const config = getConfigStore().get('accounts');
    const cookiePath = config.activeId
      ? accountCookiePath(config.activeId)
      : config.list.length > 0
        ? anonymousCookiePath()
        : legacyCookiePath();
    const cookieStore = await CookieStore.load(cookiePath);
    const http = new NicoHttp(cookieStore);
    this._instance = new NicoContext(cookieStore, http);
    return this._instance;
  }

  static get(): NicoContext {
    if (!this._instance) {
      throw new Error('NicoContext not initialized. Call initialize() first.');
    }
    return this._instance;
  }

  /** ログイン状態 (user_session Cookieが有効か) */
  async isLoggedIn(): Promise<boolean> {
    return this.cookieStore.hasLoginCookie();
  }
}
