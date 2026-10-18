import type { NgListItem } from '@shared/types';
import { NgListItemType } from '@shared/types';
import type { NgSyncResult } from '@shared/types/ngSync';
import { NicoEndpoint } from '@shared/constants';
import { NicoContext } from '../NicoContext';
import { NicoApiError } from '../NicoHttp';
import { getMyUserId } from '../follow/FollowFeedClient';
import { createLogger } from '../../util/Logger';

const log = createLogger('NgServerSync');

/** サーバー側 NG の種別 (確認できたもの。それ以外は無視する) */
type ServerNgType = 'word' | 'id';

interface ServerNgItem {
  type: string;
  source: string;
  registeredAt?: string;
}

interface ServerNgResponse {
  data?: { revision?: number; count?: number; items?: ServerNgItem[] };
}

/**
 * Web 版の NG 追加・削除のヘッダー値。ほかの書き込み系は https://www.nicovideo.jp だが、
 * NG は Web 版が `nicovideo` を送っているのでそれに合わせる。
 */
const NG_REQUEST_WITH = 'nicovideo';

/** 削除の件数がこれ以上、かつ前回同期時点の半数を超えるとき、確認なしでは実行しない */
const MASS_DELETE_MIN = 10;

/**
 * ローカル NG → サーバー NG。サーバーに相当がない種別は null (ローカル専用)。
 *  - word (部分一致) ↔ word
 *  - userId ↔ id
 *  - wordExact / command はサーバーに無い。word として送ると Web 側の NG が広がるので送らない
 */
export function toServerNg(item: NgListItem): { type: ServerNgType; source: string } | null {
  switch (item.type) {
    case NgListItemType.WORD:
      return { type: 'word', source: item.value };
    case NgListItemType.USER_ID:
      return { type: 'id', source: item.value };
    default:
      return null;
  }
}

/** サーバー NG → ローカル NG。未知の種別は null (例外にしない) */
function fromServerNg(item: ServerNgItem): NgListItem | null {
  switch (item.type) {
    case 'word':
      return { type: NgListItemType.WORD, value: item.source };
    case 'id':
      return { type: NgListItemType.USER_ID, value: item.source };
    default:
      return null;
  }
}

const key = (item: { type: string; value: string }): string => `${item.type}\u0000${item.value}`;

/** 上限到達エラーか。errorCode の具体名が未確認なので MAX / LIMIT を含むものを上限とみなす */
function isLimitError(e: unknown): boolean {
  return e instanceof NicoApiError && /MAX|LIMIT/i.test(e.errorCode ?? '');
}

export class NgServerClient {
  static async list(): Promise<ServerNgItem[]> {
    const res = await NicoContext.get().http.getJson<ServerNgResponse>(NicoEndpoint.ngCommentsClient());
    return res.data?.items ?? [];
  }

  static async add(item: { type: ServerNgType; source: string }): Promise<void> {
    await NicoContext.get().http.send('POST', NicoEndpoint.ngCommentsClient(), {
      form: { type: item.type, source: item.source },
      headers: { 'X-Request-With': NG_REQUEST_WITH }
    });
  }

  static async remove(item: { type: ServerNgType; source: string }): Promise<void> {
    await NicoContext.get().http.send('DELETE', NicoEndpoint.ngCommentsClientItems(), {
      json: { targets: [{ type: item.type, source: item.source }] },
      headers: { 'X-Request-With': NG_REQUEST_WITH }
    });
  }
}

/** 同期で使うローカルの入出力 (NgListDao の一部) */
export interface LocalNgStore {
  list(): NgListItem[];
  /** 追加できたら true、登録済みなら false */
  add(item: NgListItem): boolean;
  remove(item: NgListItem): void;
  /** 前回同期した時点の一覧 (アカウントごと)。未同期なら空 */
  getBase(account: string): NgListItem[];
  setBase(account: string, items: NgListItem[]): void;
}

/**
 * ローカルとサーバーの NG を、前回同期した時点の一覧 (基準) を使った 3 者比較でマージする。
 *
 *  - サーバーにだけある: 基準にも無ければ新規なのでローカルへ追加 / 基準にあれば「ローカルで削除した」ので、サーバーからも削除
 *  - ローカルにだけある: 基準にも無ければ新規なのでサーバーへ追加 / 基準にあれば「サーバーで削除した」ので、ローカルからも削除
 *  - 基準が無い (初回・基準を消した) 場合は削除が起きず、和集合になる
 *
 * 安全策:
 *  - サーバー一覧の取得に失敗したら例外を投げ、ローカルも基準も一切変更しない
 *  - 削除が大量 (MASS_DELETE_MIN 件以上かつ基準の半数超) のときは force でなければ何もせず aborted を返す
 *  - 送れなかった追加 (上限・通信エラー) は基準に入れない。入れると次回「サーバーで削除された」と誤判定してローカルから消える
 *  - 送れなかった削除は基準に残す。次回も同じ判定になり、再試行される
 */
export async function mergeNgWithServer(
  local: LocalNgStore,
  opts: { force?: boolean } = {}
): Promise<NgSyncResult> {
  const result: NgSyncResult = {
    pulled: 0,
    pushed: 0,
    deletedLocal: 0,
    deletedServer: 0,
    localOnly: 0,
    failed: 0,
    limitReached: false,
    serverCount: 0
  };

  const account = await getMyUserId();
  const serverItems = await NgServerClient.list(); // 失敗時はここで例外 → 何も変更しない

  const serverMap = new Map<string, NgListItem>();
  for (const s of serverItems) {
    const mapped = fromServerNg(s);
    if (mapped) serverMap.set(key(mapped), mapped);
  }
  const localMap = new Map<string, NgListItem>();
  for (const item of local.list()) {
    if (toServerNg(item)) localMap.set(key(item), item);
    else result.localOnly++;
  }
  const baseKeys = new Set(
    local
      .getBase(account)
      .filter((i) => toServerNg(i))
      .map(key)
  );

  const addLocal: NgListItem[] = [];
  const deleteServer: NgListItem[] = [];
  for (const [k, item] of serverMap) {
    if (localMap.has(k)) continue;
    (baseKeys.has(k) ? deleteServer : addLocal).push(item);
  }
  const pushServer: NgListItem[] = [];
  const deleteLocal: NgListItem[] = [];
  for (const [k, item] of localMap) {
    if (serverMap.has(k)) continue;
    (baseKeys.has(k) ? deleteLocal : pushServer).push(item);
  }

  const deletions = deleteLocal.length + deleteServer.length;
  if (!opts.force && deletions >= MASS_DELETE_MIN && deletions * 2 > baseKeys.size) {
    log.warn(`NG sync aborted: mass delete (${deletions} of base ${baseKeys.size})`);
    result.aborted = 'massDelete';
    result.deletedLocal = deleteLocal.length;
    result.deletedServer = deleteServer.length;
    result.serverCount = serverMap.size;
    return result;
  }

  const finalLocal = new Map(localMap);
  const finalServer = new Map(serverMap);
  const deleteRetry: NgListItem[] = [];

  for (const item of addLocal) {
    local.add(item);
    finalLocal.set(key(item), item);
    result.pulled++;
  }
  for (const item of deleteLocal) {
    local.remove(item);
    finalLocal.delete(key(item));
    result.deletedLocal++;
  }
  for (const item of deleteServer) {
    const mapped = toServerNg(item);
    if (!mapped) continue;
    try {
      await NgServerClient.remove(mapped);
      finalServer.delete(key(item));
      result.deletedServer++;
    } catch (e) {
      log.warn('NG delete on server failed:', e);
      result.failed++;
      deleteRetry.push(item);
    }
  }
  for (const item of pushServer) {
    const mapped = toServerNg(item);
    if (!mapped) continue;
    try {
      await NgServerClient.add(mapped);
      finalServer.set(key(item), item);
      result.pushed++;
    } catch (e) {
      if (isLimitError(e)) {
        log.warn(`NG server limit reached after pushing ${result.pushed} items`);
        result.limitReached = true;
        break;
      }
      log.warn('NG push failed:', e);
      result.failed++;
    }
  }

  // 次回の基準: 両側に揃っている NG + 削除を再試行したい NG
  const newBase: NgListItem[] = [];
  for (const [k, item] of finalLocal) if (finalServer.has(k)) newBase.push(item);
  local.setBase(account, [...newBase, ...deleteRetry]);

  result.serverCount = finalServer.size;
  return result;
}

/** 自動同期 ON のとき、ローカルでの NG 追加をサーバーへ即時反映する (失敗してもローカル操作は成功扱い) */
export async function pushNgAdd(item: NgListItem): Promise<void> {
  const mapped = toServerNg(item);
  if (!mapped) return;
  try {
    await NgServerClient.add(mapped);
  } catch (e) {
    log.warn('NG push (add) failed:', e);
  }
}

/** 自動同期 ON のとき、ローカルでの NG 削除をサーバーへ即時反映する */
export async function pushNgRemove(item: NgListItem): Promise<void> {
  const mapped = toServerNg(item);
  if (!mapped) return;
  try {
    await NgServerClient.remove(mapped);
  } catch (e) {
    log.warn('NG push (remove) failed:', e);
  }
}
