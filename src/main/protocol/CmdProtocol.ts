import { createLogger } from '../util/Logger';
import { NNDD_RE_CMD_SCHEME } from '../../shared/constants/paths';
import type { CmdApi } from '../ipc/registerIpc';

const log = createLogger('CmdProtocol');

export type CmdAction =
  | { action: 'play'; videoId: string }
  | { action: 'download'; videoId: string }
  | { action: 'mylist'; mylistId: string };

/** `nndd-re-cmd://play/sm12345` 等をパースする。形式不正・未知アクションは null */
export function parseCmdUrl(url: string): CmdAction | null {
  const prefix = `${NNDD_RE_CMD_SCHEME}://`;
  if (!url.startsWith(prefix)) return null;

  const rest = url.slice(prefix.length);
  const pathPart = rest.split(/[?#]/)[0];
  const [action, id] = pathPart.split('/').filter(Boolean);
  if (!action || !id) return null;

  switch (action) {
    case 'play':
      return { action: 'play', videoId: id };
    case 'download':
      return { action: 'download', videoId: id };
    case 'mylist':
      return { action: 'mylist', mylistId: id };
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
  }
}
