import { exec, execSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { getConfigStore } from '../config/ConfigStore';
import { createLogger } from './Logger';

const log = createLogger('BinaryInstaller');

export interface BinaryStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

export class BinaryInstaller {
  static binDir(): string {
    return path.join(app.getPath('userData'), 'bin');
  }

  static ytDlpLocalPath(): string {
    const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    return path.join(this.binDir(), name);
  }

  static ffmpegLocalPath(): string {
    const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return path.join(this.binDir(), name);
  }

  static async checkWinget(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      await execAsync('winget --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** FFmpegManager / StreamProtocol から同期で呼ぶ用 */
  static findFfmpeg(): string {
    const configured = getConfigStore().get('ffmpegPath');
    if (configured && fs.existsSync(configured)) return configured;
    const local = this.ffmpegLocalPath();
    if (fs.existsSync(local)) return local;
    return 'ffmpeg';
  }

  static async checkYtDlp(): Promise<BinaryStatus> {
    const configured = getConfigStore().get('ytDlpPath');
    if (configured && fs.existsSync(configured)) {
      return { found: true, path: configured, version: await getVersion(configured) };
    }
    const local = this.ytDlpLocalPath();
    if (fs.existsSync(local)) {
      return { found: true, path: local, version: await getVersion(local) };
    }
    try {
      await execAsync('yt-dlp --version', { timeout: 5000 });
      return { found: true, path: 'yt-dlp', version: await getVersion('yt-dlp') };
    } catch {
      return { found: false, path: null, version: null };
    }
  }

  static async checkFfmpeg(): Promise<BinaryStatus> {
    const configured = getConfigStore().get('ffmpegPath');
    if (configured && fs.existsSync(configured)) {
      return { found: true, path: configured, version: await getFfmpegVersion(configured) };
    }
    const local = this.ffmpegLocalPath();
    if (fs.existsSync(local)) {
      return { found: true, path: local, version: await getFfmpegVersion(local) };
    }
    try {
      await execAsync('ffmpeg -version', { timeout: 5000 });
      return { found: true, path: 'ffmpeg', version: await getFfmpegVersion('ffmpeg') };
    } catch {
      return { found: false, path: null, version: null };
    }
  }

  /** macOS はアーカイブ提供なし */
  static canAutoInstallFfmpeg(): boolean {
    return process.platform === 'win32' || process.platform === 'linux';
  }

  /**
   * yt-dlp のインストール/更新。
   * - 既存: `yt-dlp --update`
   * - 未インストール + winget: `winget install yt-dlp.yt-dlp`
   * - それ以外: GitHub releases からバイナリDL
   */
  static async installYtDlp(
    isUpdate: boolean,
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (isUpdate) {
      log.info('yt-dlp --update');
      const exePath = (await this.checkYtDlp()).path ?? 'yt-dlp';
      await runCommand(exePath, ['--update'], onProgress, signal);
      return;
    }
    if (await this.checkWinget()) {
      log.info('winget install yt-dlp.yt-dlp');
      await runCommand('winget', ['install', '--id', 'yt-dlp.yt-dlp', '-e', '--accept-package-agreements', '--accept-source-agreements'], onProgress, signal);
      return;
    }
    await this.downloadYtDlp(onProgress, signal);
  }

  /**
   * ffmpeg スイートのインストール/更新。
   * - winget: `winget install Gyan.FFmpeg` / `winget upgrade Gyan.FFmpeg`
   * - それ以外: yt-dlp/FFmpeg-Builds アーカイブDL
   */
  static async installFfmpegSuite(
    isUpdate: boolean,
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (await this.checkWinget()) {
      const subCmd = isUpdate ? 'upgrade' : 'install';
      log.info(`winget ${subCmd} Gyan.FFmpeg`);
      await runCommand('winget', [subCmd, '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'], onProgress, signal);
      return;
    }
    await this.downloadFfmpegSuite(onProgress, signal);
  }

  private static async downloadYtDlp(
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const binDir = this.binDir();
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    const platform = process.platform;
    const remoteName = platform === 'win32' ? 'yt-dlp.exe'
      : platform === 'darwin' ? 'yt-dlp_macos'
      : 'yt-dlp_linux';
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${remoteName}`;
    const destPath = this.ytDlpLocalPath();

    log.verbose(`Downloading yt-dlp from ${url}`);
    await downloadFile(url, destPath, onProgress, signal);
    if (platform !== 'win32') fs.chmodSync(destPath, 0o755);
    log.info('yt-dlp download complete:', destPath);
  }

  private static async downloadFfmpegSuite(
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const platform = process.platform;
    if (platform === 'darwin') {
      throw new Error('macOS は brew install ffmpeg でインストールしてください');
    }

    const binDir = this.binDir();
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    const tmpDir = path.join(os.tmpdir(), `nndd-ffmpeg-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      let archiveName: string;
      if (platform === 'win32') {
        archiveName = 'ffmpeg-master-latest-win64-gpl.zip';
      } else {
        const arch = process.arch === 'arm64' ? 'linuxarm64' : 'linux64';
        archiveName = `ffmpeg-master-latest-${arch}-gpl.tar.xz`;
      }

      const archivePath = path.join(tmpDir, archiveName);
      const url = `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/${archiveName}`;

      log.verbose(`Downloading ffmpeg from ${url}`);
      await downloadFile(url, archivePath, onProgress, signal);

      if (platform === 'win32') {
        execSync(
          `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force"`,
          { timeout: 120000 }
        );
      } else {
        execSync(`tar -xf "${archivePath}" -C "${tmpDir}"`, { timeout: 120000 });
      }

      const innerDir = archiveName.replace('.zip', '').replace('.tar.xz', '');
      const extractedBinDir = path.join(tmpDir, innerDir, 'bin');
      const ext = platform === 'win32' ? '.exe' : '';

      const ffmpegSrc = path.join(extractedBinDir, `ffmpeg${ext}`);
      const ffmpegDest = this.ffmpegLocalPath();
      fs.copyFileSync(ffmpegSrc, ffmpegDest);
      if (platform !== 'win32') fs.chmodSync(ffmpegDest, 0o755);

      log.info('ffmpeg download complete:', ffmpegDest);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

async function getVersion(exePath: string): Promise<string | null> {
  try {
    const quoted = exePath.includes(' ') ? `"${exePath}"` : exePath;
    const { stdout } = await execAsync(`${quoted} --version`, { timeout: 5000 });
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

function getFfmpegVersion(exePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(exePath, ['-version'], { windowsHide: true });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 5000);
    proc.on('close', () => {
      clearTimeout(timer);
      const first = out.trim().split('\n')[0] ?? '';
      const m = first.match(/\bversion\s+(\S+)/);
      resolve(m ? m[1] : null);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

/** コマンドを spawn して完了を待つ。進捗は indeterminate (0.1 → 1.0 on done) */
function runCommand(
  cmd: string,
  args: string[],
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }

    onProgress(0.1);
    const proc = spawn(cmd, args, { windowsHide: true });

    proc.stdout?.on('data', (d: Buffer) => log.debug(`[${cmd}] ${d.toString().trim()}`));
    proc.stderr?.on('data', (d: Buffer) => log.debug(`[${cmd}] stderr: ${d.toString().trim()}`));

    proc.on('error', (e) => reject(new Error(`${cmd} 起動失敗: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0 || code === null) {
        onProgress(1.0);
        resolve();
      } else {
        reject(new Error(`${cmd} 終了コード ${code}`));
      }
    });

    signal?.addEventListener('abort', () => {
      try { proc.kill(); } catch { /* ignore */ }
      reject(new Error('aborted'));
    }, { once: true });
  });
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }

    const doRequest = (reqUrl: string, redirectCount = 0): void => {
      if (redirectCount > 10) { reject(new Error('Too many redirects')); return; }

      const req = https.get(reqUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers['location'];
          if (!location) { reject(new Error('Redirect without location')); return; }
          res.resume();
          doRequest(location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        const tmpPath = `${destPath}.tmp`;
        const fileStream = fs.createWriteStream(tmpPath);

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress(received / total);
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tmpPath, destPath);
              resolve();
            } catch (e) { reject(e); }
          });
        });

        fileStream.on('error', (e) => {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          reject(e);
        });
      });

      req.on('error', reject);

      signal?.addEventListener('abort', () => {
        req.destroy();
        try { fs.unlinkSync(`${destPath}.tmp`); } catch { /* ignore */ }
        reject(new Error('aborted'));
      }, { once: true });
    };

    doRequest(url);
  });
}
