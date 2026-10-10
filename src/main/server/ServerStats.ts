import os from 'node:os';
import type { HttpBindMode } from '../config/ConfigStore';

/** 直近この時間内にリクエストのあったIPを「接続中」とみなす */
const CLIENT_ACTIVE_MS = 60_000;
/** 動画配信が止まってからこの時間内なら「視聴中」とみなす (ブラウザはバッファが溜まると取得を止めるため) */
const VIEWER_ACTIVE_MS = 30_000;

export interface ViewerInfo {
  ip: string;
  videoId: string;
}

export interface ServerStatsSnapshot {
  /** 直近60秒以内にアクセスのあったユニークIP数 */
  clients: number;
  /** 視聴中 (配信中、または直近30秒以内に配信のあった) のIP数 */
  viewers: number;
  viewerList: ViewerInfo[];
}

interface ViewerState {
  ip: string;
  videoId: string;
  inflight: number;
  lastActive: number;
}

/** 内蔵HTTPサーバーの接続台数・視聴数の集計 (メモリ上のみ) */
export class ServerStats {
  private readonly clientSeen = new Map<string, number>();
  private readonly viewerStates = new Map<string, ViewerState>();

  /** ステータス表示自身のアクセス等、集計対象外にしたいリクエストは呼ばない */
  recordRequest(ip: string): void {
    this.clientSeen.set(normalizeIp(ip), Date.now());
  }

  /** 動画配信の開始を記録。返り値の関数を配信終了 (res の close) で呼ぶ */
  beginStream(ip: string, videoId: string): () => void {
    const nip = normalizeIp(ip);
    const key = `${nip}\n${videoId}`;
    let state = this.viewerStates.get(key);
    if (!state) {
      state = { ip: nip, videoId, inflight: 0, lastActive: 0 };
      this.viewerStates.set(key, state);
    }
    state.inflight++;
    state.lastActive = Date.now();
    this.clientSeen.set(nip, Date.now());
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      state.inflight--;
      state.lastActive = Date.now();
    };
  }

  snapshot(): ServerStatsSnapshot {
    const now = Date.now();
    let clients = 0;
    for (const [ip, seen] of this.clientSeen) {
      if (now - seen <= CLIENT_ACTIVE_MS) clients++;
      else this.clientSeen.delete(ip);
    }
    // 視聴数は IP 単位で数える。1台が短時間に多数の動画へ取得をかける動き
    // (メタデータの先読み・サムネ生成など) を、視聴者の大量発生と誤認しないため。
    // 表示する動画は、その IP で最後に配信のあったもの
    const latestByIp = new Map<string, ViewerState>();
    for (const [key, s] of this.viewerStates) {
      if (s.inflight > 0 || now - s.lastActive <= VIEWER_ACTIVE_MS) {
        const cur = latestByIp.get(s.ip);
        if (!cur || s.lastActive > cur.lastActive) latestByIp.set(s.ip, s);
      } else {
        this.viewerStates.delete(key);
      }
    }
    const viewerList: ViewerInfo[] = [...latestByIp.values()].map((s) => ({ ip: s.ip, videoId: s.videoId }));
    return {
      clients,
      viewers: viewerList.length,
      viewerList
    };
  }
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

/** 仮想アダプタ (WSL・Hyper-V・VirtualBox・VMware・Docker 等) らしいNIC名 */
const VIRTUAL_NIC = /vethernet|virtualbox|vmware|vmnet|wsl|hyper-v|docker|veth|br-|virbr|tailscale|zerotier/i;

/** 家庭内LANらしさ (小さいほど優先): 192.168.x → 10.x → 172.16-31.x → その他 */
function lanRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2;
  return 3;
}

/** 100.64.0.0/10 (CGNAT 帯域。Tailscale がノードに割り当てる範囲) */
export function isTailscaleIp(ip: string): boolean {
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * このPCの Tailscale IPv4 を検出する (未接続なら空)。IPv6 (fd7a:…) は対象外。
 * 100.64/10 は ISP の CGNAT などでも使われうるため、NIC名が tailscale / utun (macOS) のものがあればそれを優先する。
 */
export function detectTailscaleIps(): string[] {
  const all: { ip: string; named: boolean }[] = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal && isTailscaleIp(net.address)) {
        all.push({ ip: net.address, named: /tailscale|utun/i.test(name) });
      }
    }
  }
  const named = all.filter((a) => a.named);
  return (named.length > 0 ? named : all).map((a) => a.ip);
}

/**
 * アクセス用URL一覧。
 *  - loopback: ループバックのみ
 *  - lan: 各NICのIPv4 (複数NICなら仮想アダプタを後ろ、家庭内LANらしいアドレスを前。先頭が本命)
 */
export function getAccessUrls(port: number, mode: HttpBindMode): string[] {
  // tailscale-node は待受が 127.0.0.1。公開URLは NnddHttpServer が Exposure から取得する
  if (mode === 'loopback' || mode === 'tailscale-node') return [`http://127.0.0.1:${port}/library`];
  const found: { ip: string; virtual: boolean }[] = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        found.push({ ip: net.address, virtual: VIRTUAL_NIC.test(name) });
      }
    }
  }
  found.sort((a, b) => Number(a.virtual) - Number(b.virtual) || lanRank(a.ip) - lanRank(b.ip));
  const urls = found.map((f) => `http://${f.ip}:${port}/library`);
  return urls.length > 0 ? urls : [`http://127.0.0.1:${port}/library`];
}
