import type { PlaylistItem } from '@shared/types';
import type { PlaylistSyncResult } from '@shared/types/playlist';
import { MyListClient } from './MyListClient';
import { createLogger } from '../../util/Logger';

const log = createLogger('PlaylistServerSync');

/** 削除の件数がこれ以上、かつ前回同期時点の半数を超えるとき、確認なしでは実行しない */
const MASS_DELETE_MIN = 10;

/** 同期で使うプレイリスト側の入出力 (PlaylistDao の 1 プレイリスト分) */
export interface LocalPlaylistStore {
  items(): PlaylistItem[];
  add(item: { videoId: string; title: string; thumbnailUrl: string; lengthSec: number }): void;
  remove(videoId: string): void;
  /** 前回同期した時点の動画ID一覧。未同期なら空 */
  getBase(): string[];
  setBase(videoIds: string[]): void;
}

/**
 * プレイリストとニコニコ側マイリストを、前回同期した時点の一覧 (基準) を使った 3 者比較でマージする。
 * NG の同期 (NgServerSync) と同じ方式:
 *  - 片方にだけある動画: 基準に無ければ新規なので他方へ追加 / 基準にあれば他方で削除されたので、こちらも削除
 *  - 基準が無い (初回) 場合は削除が起きず、和集合になる
 *
 * 安全策:
 *  - サーバーの取得に失敗 (または件数が多すぎて全件取れない) ときは例外にし、何も変更しない
 *  - 削除が大量のときは force でなければ何もせず aborted を返す
 *  - 反映できなかった追加は基準に入れない (入れると次回「サーバーで削除された」と誤判定してプレイリストから消える)
 *  - 反映できなかった削除は基準に残す (次回も同じ判定になり再試行される)
 *
 * 並び順は同期しない (並び替え専用の API が無い)。サーバー側から取り込んだ動画は末尾に追加される。
 */
export async function mergePlaylistWithServer(
  mylistId: string,
  local: LocalPlaylistStore,
  opts: { force?: boolean } = {}
): Promise<PlaylistSyncResult> {
  const result: PlaylistSyncResult = { pulled: 0, pushed: 0, deletedLocal: 0, deletedServer: 0, failed: 0 };

  const serverItems = await MyListClient.fetchOwnMylistAll(mylistId); // 失敗時は例外 → 何も変更しない
  const serverMap = new Map(serverItems.map((i) => [i.videoId, i]));
  const localMap = new Map(local.items().map((i) => [i.videoId, i]));
  const base = new Set(local.getBase());

  const addLocal = serverItems.filter((s) => !localMap.has(s.videoId) && !base.has(s.videoId));
  const deleteServer = serverItems.filter((s) => !localMap.has(s.videoId) && base.has(s.videoId));
  const pushServer = [...localMap.values()].filter((l) => !serverMap.has(l.videoId) && !base.has(l.videoId));
  const deleteLocal = [...localMap.values()].filter((l) => !serverMap.has(l.videoId) && base.has(l.videoId));

  const deletions = deleteLocal.length + deleteServer.length;
  if (!opts.force && deletions >= MASS_DELETE_MIN && deletions * 2 > base.size) {
    log.warn(`playlist sync aborted: mass delete (${deletions} of base ${base.size})`);
    result.aborted = 'massDelete';
    result.deletedLocal = deleteLocal.length;
    result.deletedServer = deleteServer.length;
    return result;
  }

  const finalLocal = new Set(localMap.keys());
  const finalServer = new Set(serverMap.keys());
  const deleteRetry: string[] = [];

  for (const s of addLocal) {
    local.add({ videoId: s.videoId, title: s.title, thumbnailUrl: s.thumbnailUrl, lengthSec: s.lengthSec });
    finalLocal.add(s.videoId);
    result.pulled++;
  }
  for (const l of deleteLocal) {
    local.remove(l.videoId);
    finalLocal.delete(l.videoId);
    result.deletedLocal++;
  }
  // サーバーからの削除は itemId で行う (一覧取得時に得ている)
  const deleteIds = deleteServer.map((s) => s.itemId);
  if (deleteIds.length > 0) {
    try {
      await MyListClient.removeItems(mylistId, deleteIds);
      for (const s of deleteServer) finalServer.delete(s.videoId);
      result.deletedServer += deleteServer.length;
    } catch (e) {
      log.warn('playlist sync: delete on server failed:', e);
      result.failed += deleteServer.length;
      deleteRetry.push(...deleteServer.map((s) => s.videoId));
    }
  }
  for (const l of pushServer) {
    try {
      await MyListClient.addItem(mylistId, l.videoId);
      finalServer.add(l.videoId);
      result.pushed++;
    } catch (e) {
      log.warn(`playlist sync: push failed (${l.videoId}):`, e);
      result.failed++;
    }
  }

  // 次回の基準: 両側に揃っている動画 + 削除を再試行したい動画
  const newBase = [...finalLocal].filter((id) => finalServer.has(id));
  local.setBase([...newBase, ...deleteRetry]);
  return result;
}

/** 同期中のプレイリストにローカルで動画を追加したとき、サーバーにも即時反映する (失敗してもローカル操作は成功扱い) */
export async function pushPlaylistAdd(mylistId: string, videoId: string): Promise<void> {
  try {
    await MyListClient.addItem(mylistId, videoId);
  } catch (e) {
    log.warn('playlist push (add) failed:', e);
  }
}

/** 同期中のプレイリストからローカルで動画を削除したとき、サーバーにも即時反映する。itemId はキャッシュか、見つかるまでのページ送りで引く (全件取得はしない) */
export async function pushPlaylistRemove(mylistId: string, videoId: string): Promise<void> {
  try {
    const itemId = await MyListClient.findOwnItemId(mylistId, videoId);
    if (itemId !== undefined) await MyListClient.removeItems(mylistId, [itemId]);
  } catch (e) {
    log.warn('playlist push (remove) failed:', e);
  }
}
