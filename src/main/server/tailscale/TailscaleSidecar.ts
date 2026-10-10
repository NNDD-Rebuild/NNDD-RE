import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { SecretStore } from '../SecretStore';
import { createLogger } from '../../util/Logger';
import type { Exposure, ExposureStatus } from './exposure';
import { SIDECAR_PROTOCOL } from './sidecarPin';
import { SidecarInstaller } from './SidecarInstaller';

const log = createLogger('TailscaleSidecar');

const MAX_RESTARTS = 5;
const STOP_WAIT_MS = 5000;
/** この時間 running が続いたら、再起動回数をリセットする */
const STABLE_MS = 60_000;

export interface SidecarOptions {
  /** tailnet 上の端末名 (MagicDNS 名になる) */
  hostname: string;
  /** HTTPS (443) で公開する。要: 管理画面で HTTPS 証明書を有効化 */
  https: boolean;
  /** 停止で端末一覧から消える一時的な端末にする */
  ephemeral: boolean;
}

interface SidecarEvent {
  event: string;
  protocol?: number;
  version?: string;
  state?: string;
  url?: string;
  dnsName?: string;
  ips?: string[];
  scheme?: string;
  port?: number;
  message?: string;
}

/**
 * RE 専用の独立した Tailscale 端末 (tsnet サイドカー) を子プロセスとして起動し、
 * 内蔵HTTPサーバー (127.0.0.1) を tailnet へ公開する。制御プロトコルは nndd-re-tailscale の README を参照。
 */
export class TailscaleSidecar implements Exposure {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: ExposureStatus = { state: 'idle', urls: [] };
  private port = 0;
  private wanted = false;
  private restarts = 0;
  private runningSince = 0;
  private stderrTail: string[] = [];
  /** 起動ごとに作る共有シークレット。サイドカーが転送するリクエストに付け、本体が「サイドカー経由」と判定する */
  private readonly secret = crypto.randomBytes(24).toString('base64url');

  constructor(private readonly opts: SidecarOptions) {}

  async start(port: number): Promise<void> {
    this.port = port;
    this.wanted = true;
    this.restarts = 0;
    this.spawnChild();
  }

  async refresh(): Promise<void> {
    if (!this.wanted) return;
    if (this.child) {
      if (this.status.state === 'running' && Date.now() - this.runningSince > STABLE_MS) this.restarts = 0;
      return;
    }
    // 予期せず終了していた場合は、回数を限って再起動する
    if (this.restarts < MAX_RESTARTS) {
      this.restarts++;
      log.info(`restarting sidecar (${this.restarts}/${MAX_RESTARTS})`);
      this.spawnChild();
    }
  }

  getStatus(): ExposureStatus {
    return this.status;
  }

  /** サイドカーが付けた共有シークレットか (定数時間で比較) */
  verifySecret(given: string | undefined): boolean {
    if (!given) return false;
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(this.secret).digest();
    return crypto.timingSafeEqual(a, b);
  }

  private fail(message: string): void {
    log.warn(message);
    this.status = { state: 'error', message, urls: [] };
  }

  private spawnChild(): void {
    let bin: string;
    try {
      bin = SidecarInstaller.verifyForExecution();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      // 取得・更新しない限り直らないので、再起動は試みない
      this.restarts = MAX_RESTARTS;
      return;
    }
    const args = [
      '--state-dir', SidecarInstaller.stateDir(),
      '--hostname', this.opts.hostname,
      '--upstream', `http://127.0.0.1:${this.port}`
    ];
    if (this.opts.https) args.push('--https');
    if (this.opts.ephemeral) args.push('--ephemeral');

    this.status = { state: 'starting', urls: [] };
    this.stderrTail = [];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;

    // 秘密情報 (共有シークレット・Auth key) は引数・環境変数ではなく標準入力で渡す
    const authKey = SecretStore.get('tailscaleAuthKey') ?? '';
    child.stdin.on('error', () => { /* 終了済みへの書き込みは無視 */ });
    child.stdin.write(JSON.stringify({ secret: this.secret, authKey }) + '\n');

    readline.createInterface({ input: child.stdout }).on('line', (line) => this.onLine(child, line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      log.debug('sidecar:', line);
    });
    child.on('error', (e) => {
      if (this.child === child) this.child = null;
      this.fail(`Tailscale サイドカーを起動できません: ${e.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.wanted) return;
      // サイドカー自身が error イベントで理由を出していればそれを残す
      if (this.status.state !== 'error') {
        this.fail(`Tailscale サイドカーが終了しました (code=${code ?? signal})`);
      }
    });
  }

  private onLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.child !== child) return;
    let ev: SidecarEvent;
    try {
      ev = JSON.parse(line) as SidecarEvent;
    } catch {
      log.debug('sidecar (non-json):', line);
      return;
    }
    switch (ev.event) {
      case 'hello':
        if (ev.protocol !== SIDECAR_PROTOCOL) {
          this.fail(
            `Tailscale サイドカーのプロトコル (v${ev.protocol ?? '?'}) が本体 (v${SIDECAR_PROTOCOL}) と合いません。設定 → 外部ツール で更新してください`
          );
          this.wanted = false;
          child.kill();
        }
        break;
      case 'status':
        if (ev.state === 'needs_login') {
          this.status = {
            state: 'needs_login',
            message: 'Tailscale へのログインが必要です。',
            authUrl: this.status.authUrl,
            urls: []
          };
        } else if (ev.state === 'starting' && this.status.state !== 'needs_login') {
          this.status = { state: 'starting', urls: [] };
        }
        break;
      case 'auth_url':
        this.status = {
          state: 'needs_login',
          message: 'Tailscale にログインしてこの端末を承認してください。',
          authUrl: ev.url,
          urls: []
        };
        break;
      case 'ready': {
        const scheme = ev.scheme ?? 'http';
        const defaultPort = scheme === 'https' ? 443 : 80;
        const portPart = ev.port && ev.port !== defaultPort ? `:${ev.port}` : '';
        this.status = { state: 'running', urls: ev.dnsName ? [`${scheme}://${ev.dnsName}${portPart}/library`] : [] };
        this.runningSince = Date.now();
        // Auth key は使い捨て。ログインできたら保管庫から消す
        SecretStore.delete('tailscaleAuthKey');
        break;
      }
      case 'error':
        this.fail(ev.message ?? 'Tailscale サイドカーでエラーが発生しました');
        break;
      default:
        break;
    }
  }

  /** 子プロセスの終了を待つ */
  private waitExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => { child.kill(); resolve(); }, ms);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  async stop(): Promise<void> {
    this.wanted = false;
    const child = this.child;
    this.status = { state: 'idle', urls: [] };
    if (!child) return;
    try { child.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n'); } catch { /* 終了済み */ }
    await this.waitExit(child, STOP_WAIT_MS);
  }

  /**
   * tailnet からログアウトして (端末を削除) 状態ディレクトリを消す。
   * 起動していない場合はログアウトできないので、状態だけ消す (端末は管理画面から削除する)。
   * 返り値: tailnet 側の端末も削除できた
   */
  async logout(): Promise<boolean> {
    this.wanted = false;
    const child = this.child;
    let loggedOut = false;
    if (child) {
      const onLine = readline.createInterface({ input: child.stdout });
      onLine.on('line', (l) => { if (l.includes('"logged_out"')) loggedOut = true; });
      try { child.stdin.write(JSON.stringify({ cmd: 'logout' }) + '\n'); } catch { /* 終了済み */ }
      await this.waitExit(child, 15_000);
    }
    this.status = { state: 'idle', urls: [] };
    SidecarInstaller.removeState();
    SecretStore.delete('tailscaleAuthKey');
    return loggedOut;
  }
}
