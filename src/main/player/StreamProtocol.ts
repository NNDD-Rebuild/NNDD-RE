import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { BinaryInstaller } from '../util/BinaryInstaller';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NicoContext } from '../nicovideo/NicoContext';
import { YtDlpDownloader } from '../nicovideo/video/YtDlpDownloader';
import { YtDlpStreamer } from '../nicovideo/video/YtDlpStreamer';
import { createLogger } from '../util/Logger';

const log = createLogger('StreamProtocol');

export interface MergeProgress {
  progress: number;   // 0.0 〜 1.0
  speed: string;
  eta: string;
  phase: 'video' | 'audio' | 'merging';
}

/**
 * 'wait' モード用: bestvideo+bestaudio をマージDLして localPath を返す。
 * 進捗を onProgress で通知し、完了時に onReady を呼ぶ。
 * 戻り値は cancel 関数。
 */
export function spawnMergeDownload(
  videoId: string,
  onProgress: (p: MergeProgress) => void,
  onReady: (localPath: string) => void,
  onError: (msg: string) => void
): () => void {
  const ytDlpPath = YtDlpDownloader.findExe();
  const ffmpegPath = BinaryInstaller.findFfmpeg();
  const ffmpegDir = path.dirname(ffmpegPath);

  const cacheDir = YtDlpStreamer.cacheDir();
  const cachePath = path.join(cacheDir, `${videoId}.mp4`);
  const mergeOutputPath = path.join(cacheDir, `${videoId}-wait.mp4`);

  try { if (fs.existsSync(mergeOutputPath)) fs.unlinkSync(mergeOutputPath); } catch {}

  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cookiesPath = path.join(os.tmpdir(), `nndd-wait-${ts}.txt`);

  // Cookie 書き出しは非同期だが spawn 前に完了させる必要がある。
  // Promise を返したいが関数シグネチャ上 void なので、
  // spawn 自体は cookie 書き出し後に行う。
  NicoContext.get().cookieStore.exportNetscape().then((netscape) => {
    fs.writeFileSync(cookiesPath, Buffer.from(netscape, 'utf8'));

    const url = `https://www.nicovideo.jp/watch/${videoId}`;
    log.info(`merge download start: ${videoId}`);

    const proc: ChildProcess = spawn(ytDlpPath, [
      '--cookies', cookiesPath,
      '--format', 'bestvideo[format_id*=h264]+bestaudio[format_id*=aac]/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio',
      '--ffmpeg-location', ffmpegDir,
      '--merge-output-format', 'mp4',
      '--no-playlist', '--no-warnings',
      '--progress', '--newline',
      '-o', mergeOutputPath,
      url
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

    // ダウンロード2フェーズ (video → audio) + merge をトラック
    let dlPhaseCount = 0; // 0=video, 1=audio
    const phaseNames: MergeProgress['phase'][] = ['video', 'audio', 'merging'];

    proc.stderr?.on('data', (b: Buffer) => {
      const text = b.toString();
      // 進捗行: [download]  50.0% of ~  100MiB at  4MiB/s ETA 00:12
      const m = text.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/);
      if (m) {
        const pct = parseFloat(m[1]) / 100;
        // 2ファイルで total 50% ずつ
        const overall = (dlPhaseCount * 0.5 + pct * 0.5);
        onProgress({ progress: overall, speed: m[2], eta: m[3], phase: phaseNames[dlPhaseCount] ?? 'video' });
      }
      // フェーズ完了 (100% のあとに次のフォーマットのダウンロードが始まる)
      if (text.includes('[download] 100%')) {
        dlPhaseCount = Math.min(dlPhaseCount + 1, 1);
      }
      // マージ開始
      if (text.includes('[Merger]') || text.includes('merging')) {
        onProgress({ progress: 0.99, speed: '', eta: '00:00', phase: 'merging' });
      }
    });

    proc.on('close', (code) => {
      log.info(`merge download closed: ${videoId} code=${code}`);
      try { fs.unlinkSync(cookiesPath); } catch {}
      if (code === 0 && fs.existsSync(mergeOutputPath)) {
        try {
          if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
          fs.renameSync(mergeOutputPath, cachePath);
          log.info('merge download finalized:', cachePath);
          onReady(cachePath);
        } catch (e) {
          try { fs.unlinkSync(mergeOutputPath); } catch {}
          onError(String(e));
        }
      } else if (code !== null) {
        try { if (fs.existsSync(mergeOutputPath)) fs.unlinkSync(mergeOutputPath); } catch {}
        onError(`yt-dlp exited code=${code}`);
      }
    });

    activeWaitProcs.set(videoId, proc);
  }).catch((e) => onError(String(e)));

  return () => {
    const proc = activeWaitProcs.get(videoId);
    if (proc) { killTree(proc); activeWaitProcs.delete(videoId); }
    try { fs.unlinkSync(cookiesPath); } catch {}
  };
}

/** wait モードで実行中のプロセス */
const activeWaitProcs = new Map<string, ChildProcess>();

/** 全 wait ダウンロードを強制停止 */
export function cancelAllWaitDownloads(): void {
  for (const [id, proc] of activeWaitProcs) {
    log.info('force cancel wait download:', id);
    killTree(proc);
  }
  activeWaitProcs.clear();
}


/** プロセスとその子プロセスをまとめて強制終了 */
function killTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    try { proc.kill('SIGTERM'); } catch {}
  }
}

