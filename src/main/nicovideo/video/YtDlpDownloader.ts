import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NicoContext } from '../NicoContext';
import { getConfigStore } from '../../config/ConfigStore';
import { BinaryInstaller } from '../../util/BinaryInstaller';
import { createLogger } from '../../util/Logger';

const log = createLogger('YtDlpDownloader');

export interface YtDlpDownloadOptions {
  outputPath: string;
  onProgress?: (percent: number, speed: string, eta: string) => void;
  signal?: AbortSignal;
}

export class YtDlpDownloader {
  static findExe(): string {
    const configured = getConfigStore().get('ytDlpPath');
    if (configured && fs.existsSync(configured)) return configured;
    const local = BinaryInstaller.ytDlpLocalPath();
    if (fs.existsSync(local)) return local;
    return 'yt-dlp';
  }

  static async download(videoId: string, opts: YtDlpDownloadOptions): Promise<void> {
    const exePath = this.findExe();
    const cookieStore = NicoContext.get().cookieStore;

    const cookiesPath = path.join(os.tmpdir(), `nndd-cookies-${Date.now()}.txt`);
    const netscape = await cookieStore.exportNetscape();
    fs.writeFileSync(cookiesPath, Buffer.from(netscape, 'utf8'));

    try {
      fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

      const url = `https://www.nicovideo.jp/watch/${videoId}`;
      const args = [
        '--cookies', cookiesPath,
        '--output', opts.outputPath,
        '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--newline',
        '--no-part',
        '--no-warnings',
        url,
      ];

      log.info('yt-dlp start:', exePath, url);
      log.debug('yt-dlp args:', args.join(' '));

      // video/audio 別フェーズで 0→50→100 にマッピングする
      let phase = 0; // 0=video, 1=audio
      let lastVideoPercent = 0;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(exePath, args, { windowsHide: true });

        if (opts.signal) {
          const onAbort = (): void => {
            proc.kill('SIGTERM');
            reject(new Error('ダウンロードがキャンセルされました'));
          };
          if (opts.signal.aborted) { onAbort(); return; }
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.stdout.on('data', (data: Buffer) => {
          const text = data.toString();
          for (const line of text.split('\n')) {
            // フェーズ判定: yt-dlp は video→audio の順でダウンロードする
            if (line.includes('[download] Destination:') && phase === 0 && lastVideoPercent >= 99) {
              phase = 1;
            }
            const m = line.match(/\[download\]\s+([\d.]+)%(?:.*?at\s+([\S]+))?(?:.*?ETA\s+(\S+))?/);
            if (m) {
              const pct = parseFloat(m[1]);
              const speed = m[2] ?? '';
              const eta = m[3] ?? '';
              if (phase === 0) {
                lastVideoPercent = pct;
                opts.onProgress?.(pct / 2, speed, eta);
              } else {
                opts.onProgress?.(50 + pct / 2, speed, eta);
              }
            }
          }
        });

        proc.stderr.on('data', (data: Buffer) => {
          log.warn('yt-dlp stderr:', data.toString().trim());
        });

        proc.on('error', (err) => {
          reject(new Error(`yt-dlp 起動失敗: ${err.message}`));
        });

        proc.on('close', (code) => {
          if (code === 0 || code === null) {
            opts.onProgress?.(100, '', '');
            resolve();
          } else {
            reject(new Error(`yt-dlp が終了コード ${code} で失敗しました`));
          }
        });
      });
    } finally {
      try { fs.unlinkSync(cookiesPath); } catch { /* ignore */ }
    }
  }
}
