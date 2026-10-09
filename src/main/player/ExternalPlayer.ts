import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dialog } from 'electron';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from '../util/Logger';

const log = createLogger('ExternalPlayer');

/** 外部プレイヤーが有効か (設定「外部のPlayerを使う」) */
export function isExternalPlayerEnabled(): boolean {
  return getConfigStore().get('externalPlayer.enabled');
}

function showError(message: string): void {
  void dialog.showMessageBox({ type: 'error', title: '外部プレイヤー', message });
}

/**
 * 設定で指定した外部プレイヤーを起動して、ファイルパスまたはURLを渡す (複数なら引数に並べる)。
 * 元: NativeProcessPlayerManager.play
 *
 * 引数は配列で渡す (シェルを経由しない)。起動後のプロセスは追跡しない。
 */
export function launchExternalPlayer(targets: string[]): void {
  const playerPath = getConfigStore().get('externalPlayer.path').trim();
  if (!playerPath || !fs.existsSync(playerPath)) {
    showError('外部プレイヤーの実行ファイルが見つかりません。設定 > 外部ツール で指定してください。');
    return;
  }
  if (targets.length === 0) return;

  // macOS の .app は open -a 経由でないと起動できない
  const useOpen = process.platform === 'darwin' && playerPath.toLowerCase().endsWith('.app');
  const exe = useOpen ? '/usr/bin/open' : playerPath;
  const args = useOpen ? ['-a', playerPath, ...targets] : targets;

  log.info('外部プレイヤーを起動', { exe, count: targets.length });
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => {
      log.error('外部プレイヤーの起動に失敗:', e);
      showError(`外部プレイヤーを起動できませんでした。\n${e.message}`);
    });
    child.unref();
  } catch (e) {
    log.error('外部プレイヤーの起動に失敗:', e);
    showError(`外部プレイヤーを起動できませんでした。\n${e instanceof Error ? e.message : String(e)}`);
  }
}
