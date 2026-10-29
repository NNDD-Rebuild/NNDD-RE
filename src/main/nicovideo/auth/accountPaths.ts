import path from 'node:path';
import { app } from 'electron';
import { NnddPaths } from '@shared/constants';

/** アカウント別 Cookie ファイル (userData/accounts/<userId>.json) */
export function accountCookiePath(id: string): string {
  return path.join(app.getPath('userData'), NnddPaths.ACCOUNT_COOKIE_DIR_NAME, `${id}.json`);
}

/** 旧単一アカウント時代の Cookie ファイル (userData/cookies.json) */
export function legacyCookiePath(): string {
  return path.join(app.getPath('userData'), NnddPaths.COOKIE_FILE_NAME);
}

/** ログイン中の一時 Cookie ファイル。ユーザーID確定後に accountCookiePath へ移す */
export function tempLoginCookiePath(): string {
  return accountCookiePath(`_login-${Date.now()}`);
}

/** どのアカウントでもない (ログアウト状態) 時に指す Cookie ファイル */
export function anonymousCookiePath(): string {
  return accountCookiePath('_anonymous');
}
