#!/usr/bin/env node
/**
 * Tailscale サイドカー (NNDD-Rebuild/nndd-re-tailscale) のピン留めを更新する。
 *
 *   node scripts/update-sidecar-pin.mjs v0.1.0
 *
 * 手順:
 *   1. リリースの各バイナリをダウンロードして、こちらで SHA256 を計算する
 *   2. リリースの SHA256SUMS と突き合わせる (不一致なら中止)
 *   3. src/main/server/tailscale/sidecarPin.ts を書き換える
 * 書き換え後の差分をレビューしてコミットすること。本体はここに書いたハッシュと一致するバイナリしか実行しない。
 *
 * 環境変数 SIDECAR_RELEASE_BASE でダウンロード元 (…/releases/download/<tag>) を差し替えられる (テスト用)。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error('usage: node scripts/update-sidecar-pin.mjs <tag>   (例: v0.1.0)');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinFile = path.join(root, 'src', 'main', 'server', 'tailscale', 'sidecarPin.ts');
const repo = 'NNDD-Rebuild/nndd-re-tailscale';
const base = process.env.SIDECAR_RELEASE_BASE ?? `https://github.com/${repo}/releases/download/${tag}`;

// SidecarInstaller.sidecarAssetName が返しうる資産名と一致させること
const ASSETS = [
  'nndd-re-tailscale-windows-amd64.exe',
  'nndd-re-tailscale-darwin-amd64',
  'nndd-re-tailscale-darwin-arm64',
  'nndd-re-tailscale-linux-amd64'
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = new Map();
for (const line of (await get(`${base}/SHA256SUMS`)).toString('utf8').split(/\r?\n/)) {
  const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
  if (m) sums.set(m[2], m[1]);
}

const assets = {};
for (const name of ASSETS) {
  const listed = sums.get(name);
  if (!listed) throw new Error(`SHA256SUMS に ${name} がありません`);
  const actual = createHash('sha256').update(await get(`${base}/${name}`)).digest('hex');
  if (actual !== listed) throw new Error(`${name}: ダウンロードしたファイルのハッシュが SHA256SUMS と一致しません (${actual} != ${listed})`);
  assets[name] = actual;
  console.log(`${actual}  ${name}`);
}

const src = fs.readFileSync(pinFile, 'utf8');
const body = `export const SIDECAR_PIN: SidecarPin = {\n  version: '${tag}',\n  assets: {\n${Object.entries(assets)
  .map(([k, v]) => `    '${k}': '${v}'`)
  .join(',\n')}\n  }\n};`;
const next = src.replace(/export const SIDECAR_PIN: SidecarPin = \{[\s\S]*?\n\};/, body);
if (next === src && !src.includes(`version: '${tag}'`)) throw new Error('sidecarPin.ts の SIDECAR_PIN を書き換えられませんでした');
fs.writeFileSync(pinFile, next);
console.log(`\nupdated ${path.relative(root, pinFile)} → ${tag}\n差分を確認してコミットしてください。`);
