import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createLogger } from '../../util/Logger';

const log = createLogger('TailscaleCli');

const CLI_TIMEOUT_MS = 15_000;

/** OS ごとの Tailscale CLI の既定インストール先 (見つからなければ PATH 上の `tailscale`) */
function candidatePaths(): string[] {
  switch (process.platform) {
    case 'win32': {
      const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
      return [`${pf}\\Tailscale\\tailscale.exe`, 'tailscale.exe'];
    }
    case 'darwin':
      return [
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/opt/homebrew/bin/tailscale',
        '/usr/local/bin/tailscale',
        'tailscale'
      ];
    default:
      return ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale'];
  }
}

export class TailscaleCliError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message);
  }
}

function run(bin: string, args: string[], timeout = CLI_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new TailscaleCliError(`${bin} ${args.join(' ')} failed: ${err.message}`, String(stderr ?? '')));
        return;
      }
      resolve(String(stdout));
    });
  });
}

let cachedBin: string | null | undefined;

/** CLI の場所のキャッシュを捨てる (アンインストール・移動された場合に再探索させる) */
export function resetTailscaleCliCache(): void {
  cachedBin = undefined;
}

/** 実行ファイルが見つからないエラーか */
export function isNotFoundError(e: unknown): boolean {
  return /ENOENT/.test(e instanceof Error ? e.message : String(e));
}

/** Tailscale CLI の場所を解決する (見つからなければ null。結果は成功時のみキャッシュ) */
export async function findTailscaleCli(): Promise<string | null> {
  if (cachedBin) return cachedBin;
  for (const bin of candidatePaths()) {
    if (bin.includes('/') || bin.includes('\\')) {
      if (!fs.existsSync(bin)) continue;
    }
    try {
      await run(bin, ['version'], 5000);
      cachedBin = bin;
      return bin;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

export interface TailscaleStatus {
  /** BackendState が Running (tailnet に接続済み) */
  running: boolean;
  backendState: string;
  /** MagicDNS 名 (末尾のドットなし)。MagicDNS 無効なら null */
  dnsName: string | null;
  ips: string[];
  /** HTTPS 証明書を発行できるドメイン (管理画面で HTTPS を有効にしていると入る) */
  certDomains: string[];
}

export async function getTailscaleStatus(bin: string): Promise<TailscaleStatus> {
  const raw = await run(bin, ['status', '--json']);
  const j = JSON.parse(raw) as {
    BackendState?: string;
    Self?: { DNSName?: string; TailscaleIPs?: string[] };
    CertDomains?: string[];
  };
  const dns = j.Self?.DNSName?.replace(/\.$/, '') ?? '';
  return {
    running: j.BackendState === 'Running',
    backendState: j.BackendState ?? 'Unknown',
    dnsName: dns || null,
    ips: j.Self?.TailscaleIPs ?? [],
    certDomains: j.CertDomains ?? []
  };
}

export interface ServeEntry {
  /** 公開している HTTPS ポート */
  httpsPort: number;
  /** プロキシ先 (例 http://127.0.0.1:12345) */
  proxy: string | null;
}

interface ServeStatusJson {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }>;
}

/** 現在の `tailscale serve` 設定のうち HTTPS で公開されているポートの一覧 */
export async function getServeEntries(bin: string): Promise<ServeEntry[]> {
  let raw: string;
  try {
    raw = await run(bin, ['serve', 'status', '--json']);
  } catch (e) {
    // 設定が空のとき、古い CLI は非 0 終了することがある
    log.debug('serve status failed (treated as empty):', e instanceof Error ? e.message : e);
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '{}') return [];
  const j = JSON.parse(trimmed) as ServeStatusJson;
  const entries: ServeEntry[] = [];
  for (const [port, cfg] of Object.entries(j.TCP ?? {})) {
    if (!cfg.HTTPS) continue;
    let proxy: string | null = null;
    for (const [hostPort, web] of Object.entries(j.Web ?? {})) {
      if (!hostPort.endsWith(`:${port}`)) continue;
      proxy = web.Handlers?.['/']?.Proxy ?? null;
    }
    entries.push({ httpsPort: Number(port), proxy });
  }
  return entries;
}

/** `tailscale serve --bg --https=<port> <target>` */
export async function serveStart(bin: string, httpsPort: number, target: string): Promise<void> {
  await run(bin, ['serve', '--bg', `--https=${httpsPort}`, target]);
}

/** `tailscale serve --https=<port> off` (指定ポートだけを外す。`serve reset` は使わない) */
export async function serveOff(bin: string, httpsPort: number): Promise<void> {
  await run(bin, ['serve', `--https=${httpsPort}`, 'off']);
}

/** 権限不足 (Linux で operator 未設定) らしいエラーか */
export function isPermissionError(e: unknown): boolean {
  const text = e instanceof TailscaleCliError ? `${e.message} ${e.stderr}` : String(e);
  return /access denied|permission denied|operator|sudo/i.test(text);
}
