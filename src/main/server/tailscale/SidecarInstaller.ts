import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { downloadFile } from '../../util/BinaryInstaller';
import { createLogger } from '../../util/Logger';
import { SIDECAR_PIN, SIDECAR_REPO, type SidecarPin } from './sidecarPin';

const log = createLogger('SidecarInstaller');

export interface SidecarStatus {
  /** この OS / アーキテクチャ向けのビルドがある */
  supported: boolean;
  /** 本体にピン留めされたリリースがある (無いと取得できない) */
  canInstall: boolean;
  /** 取得済み (ファイルがある) */
  installed: boolean;
  /** 取得済みのバージョン (マーカーファイルの内容) */
  version: string | null;
  /** 本体がピン留めしているバージョン */
  pinnedVersion: string | null;
  /** 取得済みが、ピン留めと同じバージョン・同じハッシュ */
  upToDate: boolean;
  path: string;
}

/** 資産名 (`nndd-re-tailscale-<os>-<arch>[.exe]`)。未対応の組み合わせは null */
export function sidecarAssetName(platform = process.platform, arch = process.arch): string | null {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!os || !cpu) return null;
  // 配布しているビルド: linux/amd64、windows/amd64、darwin/amd64、darwin/arm64
  if (os !== 'darwin' && cpu !== 'amd64') return null;
  return `nndd-re-tailscale-${os}-${cpu}${os === 'windows' ? '.exe' : ''}`;
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Tailscale サイドカーの取得・検証・削除。取得したバイナリは実行前に毎回ハッシュを照合する */
export class SidecarInstaller {
  /** テストで差し替えられるようにする */
  static pin: SidecarPin = SIDECAR_PIN;

  static dir(): string {
    return path.join(app.getPath('userData'), 'bin');
  }

  static localPath(): string {
    return path.join(this.dir(), process.platform === 'win32' ? 'nndd-re-tailscale.exe' : 'nndd-re-tailscale');
  }

  private static markerPath(): string {
    return `${this.localPath()}.version`;
  }

  /** 状態ディレクトリ (ノード鍵が入る。ログアウト・削除時に消す) */
  static stateDir(): string {
    return path.join(app.getPath('userData'), 'tailscale-node');
  }

  private static installedVersion(): string | null {
    try {
      return fs.readFileSync(this.markerPath(), 'utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  private static expectedSha(): string | null {
    const asset = sidecarAssetName();
    return asset ? this.pin.assets[asset] ?? null : null;
  }

  static status(): SidecarStatus {
    const asset = sidecarAssetName();
    const expected = this.expectedSha();
    const canInstall = !!asset && !!this.pin.version && !!expected;
    const installed = fs.existsSync(this.localPath());
    const version = installed ? this.installedVersion() : null;
    return {
      supported: asset !== null,
      canInstall,
      installed,
      version,
      pinnedVersion: this.pin.version || null,
      upToDate: installed && version === (this.pin.version || null) && canInstall,
      path: this.localPath()
    };
  }

  /**
   * 取得する。ピン留めされたバージョンとハッシュが無ければ失敗 (fail-closed)。
   * ハッシュが一致しないファイルは置かない。
   */
  static async install(onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
    const asset = sidecarAssetName();
    if (!asset) throw new Error('このOS・CPU向けの Tailscale サイドカーはありません');
    const expected = this.expectedSha();
    if (!this.pin.version || !expected) {
      throw new Error('この NNDD-RE には Tailscale サイドカーのリリースが設定されていません (ハッシュを検証できないため取得しません)');
    }
    fs.mkdirSync(this.dir(), { recursive: true });
    const url = `https://github.com/${SIDECAR_REPO}/releases/download/${this.pin.version}/${asset}`;
    log.info(`Downloading Tailscale sidecar ${this.pin.version}: ${url}`);
    await downloadFile(url, this.localPath(), onProgress, signal, expected);
    if (process.platform !== 'win32') fs.chmodSync(this.localPath(), 0o755);
    fs.writeFileSync(this.markerPath(), this.pin.version, 'utf-8');
    log.info('Tailscale sidecar installed:', this.localPath());
  }

  /**
   * 実行してよいか検証して、実行ファイルのパスを返す (起動のたびに呼ぶ)。
   * ファイルが無い・ピンと違うバージョン・ハッシュ不一致のときは throw。
   */
  static verifyForExecution(): string {
    const expected = this.expectedSha();
    if (!this.pin.version || !expected) {
      throw new Error('Tailscale サイドカーのリリースが設定されていません');
    }
    const file = this.localPath();
    if (!fs.existsSync(file)) {
      throw new Error('Tailscale サイドカーが未取得です。設定 → 外部ツール で取得してください');
    }
    if (this.installedVersion() !== this.pin.version) {
      throw new Error(`Tailscale サイドカーが古い (または不明な) バージョンです。設定 → 外部ツール で更新してください (必要: ${this.pin.version})`);
    }
    if (sha256File(file) !== expected) {
      throw new Error('Tailscale サイドカーのファイルが想定と一致しません (改ざん・破損の可能性)。設定 → 外部ツール で取得し直してください');
    }
    return file;
  }

  /** バイナリを削除する (ログイン状態 = 状態ディレクトリは別。ログアウトで消す) */
  static uninstall(): void {
    for (const f of [this.localPath(), this.markerPath()]) {
      try { fs.rmSync(f, { force: true }); } catch (e) { log.warn('uninstall failed:', f, e); }
    }
  }

  /** 状態ディレクトリ (ノード鍵) を消す */
  static removeState(): void {
    try { fs.rmSync(this.stateDir(), { recursive: true, force: true }); } catch (e) { log.warn('removeState failed:', e); }
  }
}
