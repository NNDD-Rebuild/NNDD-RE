import { createLogger } from '../util/Logger';
import { NNDD_RE_CMD_SCHEME } from '../../shared/constants/paths';
import { isVideoId } from '../../shared/utils/videoId';
import { isLiveProgramId } from '../../shared/utils/liveId';
import { NgListItemType, type NgListItemTypeValue } from '../../shared/types/comment';
import type { CmdApi } from '../ipc/registerIpc';
import { LivePlayerManager } from '../player/LivePlayerManager';
import { askLiveRecordMode } from '../ipc/handlers/live';
import { normalizeLiveId } from '../nicovideo/live/LiveWatchPage';

const log = createLogger('CmdProtocol');

/** ngAdd の値の最大長 (OS 経由で任意の値が来るため) */
const NG_VALUE_MAX_LENGTH = 500;

export type CmdAction =
  | { action: 'play'; videoId: string }
  | { action: 'download'; videoId: string }
  | { action: 'mylist'; mylistId: string }
  | { action: 'live'; programId: string; fromNcv?: boolean }
  | { action: 'liveRecord'; programId: string }
  | { action: 'ngAdd'; type: NgListItemTypeValue; value: string };

/**
 * `nndd-re-cmd://play/sm12345` 等をパースする。形式不正・未知アクションは null。
 * OS 経由で任意の URL が来るため、ID は下流 (DL ファイル名・URL 組み立て) に渡す前に形式を検証する。
 * 生放送の ID は handleCmdUrl の normalizeLiveId で検証する。
 */
export function parseCmdUrl(url: string): CmdAction | null {
  const prefix = `${NNDD_RE_CMD_SCHEME}://`;
  if (!url.startsWith(prefix)) return null;

  const rest = url.slice(prefix.length);
  const pathPart = rest.split(/[?#]/)[0];
  const [action, id, extra] = pathPart.split('/').filter(Boolean);
  if (!action || !id) return null;

  if (action === 'ngAdd') {
    // ngAdd/<type>/<URLエンコードした値>。値の '/' は %2F になるので、3 区切り目が値
    if (!extra || !(Object.values(NgListItemType) as string[]).includes(id)) return null;
    let value: string;
    try {
      value = decodeURIComponent(extra);
    } catch {
      return null;
    }
    if (!value.trim() || value.length > NG_VALUE_MAX_LENGTH) return null;
    return { action: 'ngAdd', type: id as NgListItemTypeValue, value };
  }

  switch (action) {
    case 'play':
      return isVideoId(id) ? { action: 'play', videoId: id } : null;
    case 'download':
      return isVideoId(id) ? { action: 'download', videoId: id } : null;
    case 'mylist':
      return /^\d+$/.test(id) ? { action: 'mylist', mylistId: id } : null;
    case 'live':
      return { action: 'live', programId: id, fromNcv: /[?&]from=ncv(?:&|#|$)/.test(rest) };
    case 'liveRecord':
      return { action: 'liveRecord', programId: id };
    default:
      return null;
  }
}

/** コマンドライン引数配列 (argv) から `nndd-re-cmd://` URL を1つ探す */
export function extractCmdUrlFromArgv(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${NNDD_RE_CMD_SCHEME}://`)) ?? null;
}

/** パース済みコマンドを実行する */
export function handleCmdUrl(url: string, api: CmdApi): void {
  const parsed = parseCmdUrl(url);
  if (!parsed) {
    log.warn('unrecognized cmd URL:', url);
    return;
  }
  log.info('handling cmd URL:', url);

  switch (parsed.action) {
    case 'play':
      void api.openPlayer({ videoId: parsed.videoId }).catch((e) => log.error('openPlayer failed:', e));
      break;
    case 'download':
      try {
        api.enqueueDownload({ videoId: parsed.videoId });
      } catch (e) {
        log.error('enqueueDownload failed:', e);
      }
      break;
    case 'mylist':
      api.navigateMylist(parsed.mylistId);
      break;
    case 'live': {
      const id = normalizeLiveId(parsed.programId);
      if (id) LivePlayerManager.get().open(id, { fromNcv: parsed.fromNcv });
      else log.warn('invalid live id:', parsed.programId);
      break;
    }
    case 'liveRecord': {
      // 放送中の番組を録画する。放送開始から録画できる番組は確認ダイアログで選ばせる。
      // 終了済み・録画不可の番組はキュー側でエラー終了し、DLリストに理由が出る
      // co/ch は番組IDではない (enqueue が生放送として扱わない) ので、lv のみ受け付ける
      const id = normalizeLiveId(parsed.programId);
      if (!id || !isLiveProgramId(id)) {
        log.warn('invalid live id for record:', parsed.programId);
        break;
      }
      void askLiveRecordMode(id)
        .then((choice) => {
          if (choice === 'cancel') return;
          api.enqueueDownload({ videoId: id, record: true, fromStart: choice === 'fromStart' });
        })
        .catch((e) => log.error('live record failed:', e));
      break;
    }
    case 'ngAdd':
      api.addNgComment({ type: parsed.type, value: parsed.value });
      break;
  }
}
