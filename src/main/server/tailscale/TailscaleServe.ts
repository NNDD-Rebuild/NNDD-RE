import { createLogger } from '../../util/Logger';
import type { Exposure, ExposureStatus } from './exposure';
import {
  findTailscaleCli,
  getServeEntries,
  getTailscaleStatus,
  isCertError,
  isNotFoundError,
  isPermissionError,
  resetTailscaleCliCache,
  serveOff,
  serveStart,
  TailscaleCliError
} from './TailscaleCli';

const log = createLogger('TailscaleServe');

/**
 * 既存の Tailscale (ユーザーが導入済みの tailscaled) の `tailscale serve` で内蔵HTTPサーバーを HTTPS 公開する。
 *
 * ユーザーが既に設定している serve を壊さないための方針:
 *  - 専用の HTTPS ポート (既定 8443) を使う
 *  - そのポートが別の用途で使われていたら何も変更せずエラーにする
 *  - 停止時は自分が作ったエントリ (同じポート・同じプロキシ先) だけを外す。`serve reset` は使わない
 */
export class TailscaleServe implements Exposure {
  private status: ExposureStatus = { state: 'idle', urls: [] };
  private bin: string | null = null;
  private port = 0;
  /** 自分が作った (または自分と完全に同じ内容の) エントリ。停止時に外してよいのはこれだけ */
  private owned = false;
  /** 実行中の確認 (15 秒周期の refresh が前回の確認と重ならないようにする) */
  private ensuring: Promise<void> | null = null;

  constructor(private readonly httpsPort: number) {}

  private target(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(port: number): Promise<void> {
    this.port = port;
    this.status = { state: 'starting', urls: [] };
    await this.ensure();
  }

  async refresh(): Promise<void> {
    if (this.status.state === 'idle') return;
    await this.ensure();
  }

  private fail(message: string): void {
    log.warn(message);
    this.status = { state: 'error', message, urls: [] };
  }

  private ensure(): Promise<void> {
    this.ensuring ??= this.doEnsure().finally(() => { this.ensuring = null; });
    return this.ensuring;
  }

  private async doEnsure(): Promise<void> {
    try {
      this.bin ??= await findTailscaleCli();
      if (!this.bin) {
        this.fail('Tailscale がインストールされていません (tailscale コマンドが見つかりません)。');
        return;
      }
      const ts = await getTailscaleStatus(this.bin);
      if (!ts.running) {
        this.status = {
          state: 'needs_login',
          message: `Tailscale に接続されていません (状態: ${ts.backendState})。Tailscale を起動してログインしてください。`,
          urls: []
        };
        return;
      }
      if (!ts.dnsName) {
        this.fail('MagicDNS が無効です。Tailscale の管理画面で MagicDNS と HTTPS 証明書を有効にしてください。');
        return;
      }
      const mine = this.target();
      const entry = (await getServeEntries(this.bin)).find((x) => x.port === this.httpsPort);
      // 同じポートが何らかの形 (HTTP / TCP 転送 / 他のパスのハンドラ / 別のプロキシ先) で使われていたら、既存設定を変更しない
      if (entry && !(entry.https && entry.onlyRoot && entry.proxy === mine)) {
        this.owned = false;
        this.fail(
          `ポート ${this.httpsPort} は別の用途で使われています (${entry.proxy ?? 'HTTPS 以外または別の設定'})。` +
            '設定で別のポートを選んでください。既存の設定は変更していません。'
        );
        return;
      }
      if (entry) {
        // 前回の起動で作った (アプリが異常終了して残った) 同一内容のエントリ。引き継ぐ
        this.owned = true;
      } else {
        await serveStart(this.bin, this.httpsPort, mine);
        this.owned = true;
        log.info(`tailscale serve: https:${this.httpsPort} → ${mine}`);
      }
      const portPart = this.httpsPort === 443 ? '' : `:${this.httpsPort}`;
      this.status = { state: 'running', urls: [`https://${ts.dnsName}${portPart}/library`] };
    } catch (e) {
      if (isNotFoundError(e)) {
        // 実行中にアンインストールされた場合など。次回の確認で再探索する
        this.bin = null;
        resetTailscaleCliCache();
        this.fail('Tailscale がインストールされていません (tailscale コマンドが見つかりません)。');
      } else if (isPermissionError(e)) {
        this.fail(
          'tailscale serve の実行権限がありません。Linux では `sudo tailscale set --operator=$USER` を実行してください。'
        );
      } else if (isCertError(e)) {
        this.fail('HTTPS 証明書が有効ではありません。Tailscale の管理画面 (DNS) で「HTTPS Certificates」を有効にしてください。');
      } else {
        this.fail(`Tailscale Serve の設定に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async stop(): Promise<void> {
    const owned = this.owned;
    this.owned = false;
    this.status = { state: 'idle', urls: [] };
    if (!this.bin || !owned) return;
    try {
      // 自分が作った (同じポート・同じ内容の) エントリだけを外す。念のため現在の内容も再確認する
      const entry = (await getServeEntries(this.bin)).find((x) => x.port === this.httpsPort);
      if (entry && entry.https && entry.onlyRoot && entry.proxy === this.target()) {
        await serveOff(this.bin, this.httpsPort);
        log.info(`tailscale serve: https:${this.httpsPort} off`);
      }
    } catch (e) {
      log.warn('tailscale serve off failed:', e instanceof Error ? e.message : e);
    }
  }

  getStatus(): ExposureStatus {
    return this.status;
  }
}
