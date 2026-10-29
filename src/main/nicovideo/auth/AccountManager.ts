import fs from 'node:fs';
import { session } from 'electron';
import { NicoEndpoint } from '@shared/constants';
import type { AccountsState, NicoAccount } from '@shared/types';
import { getConfigStore, type NnddConfig } from '../../config/ConfigStore';
import { NicoContext } from '../NicoContext';
import { NicoHttp } from '../NicoHttp';
import { MyListClient } from '../mylist/MyListClient';
import { createLogger } from '../../util/Logger';
import { CookieStore } from './CookieStore';
import { accountCookiePath, anonymousCookiePath } from './accountPaths';

const log = createLogger('AccountManager');

type StoredAccount = NnddConfig['accounts']['list'][number];

interface Profile {
  id: string;
  nickname: string;
  iconUrl?: string;
  isPremium: boolean;
}

const PROFILE_TIMEOUT_MS = 8000;

/**
 * ニコニコのマルチアカウント管理。
 * アカウントごとに Cookie ファイル (userData/accounts/<userId>.json) と保存パスワードを持ち、
 * NicoContext の CookieStore を差し替えることで切り替える (NicoHttp 等の参照はそのまま)。
 * ユーザーID・ニックネーム・アイコン・プレミアム状態は nvapi /v1/users/me から取得する。
 */
export class AccountManager {
  private static notifier: ((state: AccountsState) => void) | null = null;

  /** renderer への変更通知先を登録 (メインウィンドウ生成後に呼ぶ) */
  static setNotifier(fn: (state: AccountsState) => void): void {
    this.notifier = fn;
  }

  private static notify(): void {
    this.notifier?.(this.getState());
    this.emitActiveChange();
  }

  private static activeListeners: ((accountKey: string) => void)[] = [];
  private static lastEmittedKey: string | null = null;

  /**
   * アクティブアカウントが変わったとき (起動後の最初の通知を含む) に呼ばれるリスナーを登録する。
   * 切替で捨てるべきメモリ上の基準 (通知済み一覧など) のリセットや、アカウント別データの引き継ぎに使う。
   */
  static onActiveChange(fn: (accountKey: string) => void): void {
    this.activeListeners.push(fn);
    // 登録時点のアクティブアカウントも通知する (起動時の初期化が登録より先に終わっていても取りこぼさない)
    this.lastEmittedKey = this.key;
    try {
      fn(this.key);
    } catch (e) {
      log.warn('active change listener failed:', e);
    }
  }

  /** 未ログインのときは空文字。アカウント別に持つローカルデータ (マイリストなど) の所有者キー */
  static get key(): string {
    return this.activeId ?? '';
  }

  private static emitActiveChange(): void {
    const key = this.key;
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
    for (const fn of this.activeListeners) {
      try {
        fn(key);
      } catch (e) {
        log.warn('active change listener failed:', e);
      }
    }
  }

  private static list(): StoredAccount[] {
    return getConfigStore().get('accounts').list;
  }

  private static save(list: StoredAccount[], activeId: string | undefined): void {
    getConfigStore().set('accounts', { list, activeId });
  }

  static get activeId(): string | null {
    return getConfigStore().get('accounts').activeId ?? null;
  }

  /** アクティブアカウントの保存情報 (未選択なら null) */
  static getActive(): StoredAccount | null {
    const id = this.activeId;
    return this.list().find((a) => a.id === id) ?? null;
  }

  /** UI 向けの状態。認証情報は含めない */
  static getState(): AccountsState {
    const accounts: NicoAccount[] = this.list().map((a) => ({
      id: a.id,
      nickname: a.nickname,
      iconUrl: a.iconUrl,
      isPremium: a.isPremium,
      hasCredentials: !!(a.email && a.passwordEnc)
    }));
    return { accounts, activeId: this.activeId };
  }

  /** nvapi /v1/users/me からプロフィールを取得。失敗/未ログインなら null */
  static async fetchProfile(store: CookieStore): Promise<Profile | null> {
    try {
      const res = await new NicoHttp(store).fetch(NicoEndpoint.me(), {
        timeoutMs: PROFILE_TIMEOUT_MS
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { user?: Record<string, unknown> } };
      const u = json.data?.user;
      if (!u || u['id'] == null) return null;
      const id = String(u['id']);
      if (!/^\d+$/.test(id)) return null;
      return {
        id,
        nickname: typeof u['nickname'] === 'string' && u['nickname'] ? u['nickname'] : id,
        iconUrl: pickIconUrl(u, id),
        isPremium: u['isPremium'] === true
      };
    } catch (e) {
      log.warn('fetchProfile failed:', e);
      return null;
    }
  }

  /**
   * ログイン直後の一時 CookieStore を取り込む。
   * ユーザーID確定 → Cookie をアカウント別ファイルへ移す → アクティブ化。
   * ログイン済みの同一アカウントなら Cookie だけ更新する。
   */
  static async adopt(temp: CookieStore): Promise<boolean> {
    const profile = await this.fetchProfile(temp);
    if (!profile) {
      log.warn('adopt: could not resolve user profile');
      return false;
    }
    await temp.relocate(accountCookiePath(profile.id));
    this.upsert(profile);
    await this.activate(profile.id);
    return true;
  }

  private static upsert(profile: Profile): void {
    const list = this.list();
    const idx = list.findIndex((a) => a.id === profile.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...profile };
    else list.push({ ...profile });
    this.save(list, this.activeId ?? undefined);
  }

  /** アクティブアカウントを切り替え、NicoContext の Cookie を差し替える */
  static async activate(id: string): Promise<boolean> {
    if (!this.list().some((a) => a.id === id)) return false;
    // Cookie を差し替えたらすぐ activeId も切り替える (Cookie と AccountManager.key がずれる時間を短くする)
    await this.applyCookieFile(accountCookiePath(id), () => this.save(this.list(), id));
    this.notify();
    return true;
  }

  /** アクティブなし (ログアウト状態) にする */
  static async deactivate(): Promise<void> {
    await this.applyCookieFile(anonymousCookiePath(), () => this.save(this.list(), undefined));
    this.notify();
  }

  private static async applyCookieFile(filePath: string, onSwitched?: () => void): Promise<void> {
    await NicoContext.get().cookieStore.switchFile(filePath);
    onSwitched?.();
    // 自分のマイリスト所有確認キャッシュはアカウント固有
    MyListClient.clearOwnMylistCache();
    // プレイヤー用 partition に前アカウントの Cookie が残らないようにする (次回表示時に再注入される)
    await session
      .fromPartition('persist:niconico')
      .clearStorageData({ storages: ['cookies'] })
      .catch((e) => log.warn('clear persist:niconico cookies failed:', e));
  }

  /** アカウント削除。Cookie ファイルと保存パスワードも破棄する */
  static async remove(id: string): Promise<boolean> {
    const list = this.list();
    if (!list.some((a) => a.id === id)) return false;
    const wasActive = this.activeId === id;
    this.save(
      list.filter((a) => a.id !== id),
      wasActive ? undefined : (this.activeId ?? undefined)
    );
    if (wasActive) await this.applyCookieFile(anonymousCookiePath());
    const file = accountCookiePath(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this.notify();
    return true;
  }

  /** アクティブアカウントのプロフィール (ニックネーム・アイコン・プレミアム) を更新 */
  static async refreshActiveProfile(): Promise<void> {
    const active = this.getActive();
    if (!active) return;
    const profile = await this.fetchProfile(NicoContext.get().cookieStore);
    // 別人のセッションに入れ替わっていた場合は触らない
    if (!profile || profile.id !== active.id) return;
    if (
      profile.nickname === active.nickname &&
      profile.iconUrl === active.iconUrl &&
      profile.isPremium === active.isPremium
    ) {
      return;
    }
    this.upsert(profile);
    this.notify();
  }

  /** アクティブアカウントの保存パスワードを更新 (ログイン済みの状態で呼ぶ) */
  static setCredentials(email: string, passwordEnc: string): boolean {
    const id = this.activeId;
    const list = this.list();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    list[idx] = { ...list[idx], email, passwordEnc };
    this.save(list, id ?? undefined);
    this.notify();
    return true;
  }

  static clearCredentials(): void {
    const id = this.activeId;
    const list = this.list();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const { email: _email, passwordEnc: _enc, ...rest } = list[idx];
    list[idx] = rest;
    this.save(list, id ?? undefined);
    this.notify();
  }

  /**
   * 起動時の初期化 (NicoContext 初期化後)。
   * 旧単一アカウント時代の cookies.json / auth を、ログイン中ならアカウントへ移行する。
   * ネットワーク不通で移行できなくても旧 Cookie のまま動くので、次回起動で再試行される。
   */
  static async initialize(): Promise<void> {
    try {
      if (this.list().length === 0) {
        await this.migrateLegacy();
      } else {
        await this.refreshActiveProfile();
      }
    } catch (e) {
      log.warn('initialize failed:', e);
    }
  }

  private static async migrateLegacy(): Promise<void> {
    const ctx = NicoContext.get();
    if (!(await ctx.isLoggedIn())) return;
    const profile = await this.fetchProfile(ctx.cookieStore);
    if (!profile) return;
    await ctx.cookieStore.relocate(accountCookiePath(profile.id));
    const legacyAuth = getConfigStore().get('auth');
    const stored: StoredAccount = { ...profile };
    if (legacyAuth.savedEmail && legacyAuth.savedPasswordEnc) {
      stored.email = legacyAuth.savedEmail;
      stored.passwordEnc = legacyAuth.savedPasswordEnc;
    }
    this.save([stored], profile.id);
    getConfigStore().set('auth', {});
    log.info('migrated legacy session to account:', profile.id);
    this.notify();
  }
}

/** 本家のアイコンURL規則: /usericon/{id/10000}/{id}.jpg。レスポンスに含まれていればそちらを優先 */
function pickIconUrl(user: Record<string, unknown>, id: string): string {
  const icons = user['icons'] as { urls?: Record<string, unknown>; large?: unknown } | undefined;
  const urls = icons?.urls ? Object.values(icons.urls) : [];
  const fromApi =
    (icons?.urls?.['150x150'] as string | undefined) ??
    (typeof icons?.large === 'string' ? icons.large : undefined) ??
    (typeof user['iconUrl'] === 'string' ? (user['iconUrl'] as string) : undefined) ??
    (urls.find((u) => typeof u === 'string') as string | undefined);
  if (fromApi) return fromApi;
  return `https://secure-dcdn.cdn.nimg.jp/nicoaccount/usericon/${Math.floor(Number(id) / 10000)}/${id}.jpg`;
}
