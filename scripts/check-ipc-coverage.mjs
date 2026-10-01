#!/usr/bin/env node
/**
 * IpcChannel の全キーと、メインプロセスでの ipcMain.handle / ipcMain.on 登録を突き合わせる。
 *
 *   npm run check:ipc
 *
 * 出力:
 *   - 定義数・登録数のサマリー
 *   - 二重登録 (同じキーを 2 回以上登録)          → エラー (終了コード 1)
 *   - IpcChannel に無いキーの登録                  → エラー (終了コード 1)
 *   - チャンネル名を静的に読めない登録             → 警告
 *   - 未登録キー (main → renderer の送信専用 / 用途不明) → 情報
 *
 * テストが無いため、registerIpc の分割など構造変更の前後でこの出力が一致することを確認する用途。
 * 正規表現による静的解析なので、`ipcMain.handle(IpcChannel.XXX, ...)` の形で書かれている前提。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ipcTypesFile = path.join(root, 'src', 'shared', 'types', 'ipc.ts');
const mainDir = path.join(root, 'src', 'main');

/** 行頭が // または * のコメント行を除く (コメントアウトされた登録を数えないため) */
function stripCommentLines(src) {
  return src
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
    })
    .join('\n');
}

function readChannelKeys() {
  const src = fs.readFileSync(ipcTypesFile, 'utf8');
  const start = src.indexOf('export const IpcChannel = {');
  const end = src.indexOf('} as const', start);
  if (start < 0 || end < 0) {
    throw new Error(`IpcChannel の定義が見つかりません: ${ipcTypesFile}`);
  }
  const body = stripCommentLines(src.slice(start, end));
  const keys = [];
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*['"]/gm;
  let m;
  while ((m = re.exec(body))) keys.push(m[1]);
  return keys;
}

function listTsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // 自動生成コード (protobuf) は対象外
      if (ent.name === 'gen' || ent.name === 'node_modules') continue;
      out.push(...listTsFiles(p));
    } else if (ent.isFile() && /\.tsx?$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function scanMain() {
  /** @type {Array<{ key: string; kind: string; file: string; line: number }>} */
  const registrations = [];
  /** @type {Array<{ text: string; file: string; line: number }>} */
  const unresolved = [];
  const sent = new Set();

  for (const file of listTsFiles(mainDir)) {
    const src = stripCommentLines(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(root, file).split(path.sep).join('/');

    const regRe = /ipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(\s*([^,)]*)/g;
    let m;
    while ((m = regRe.exec(src))) {
      const kind = m[1];
      const arg = m[2].trim();
      const line = lineOf(src, m.index);
      const km = /^IpcChannel\s*\.\s*([A-Z][A-Z0-9_]*)$/.exec(arg);
      if (km) {
        registrations.push({ key: km[1], kind, file: rel, line });
      } else {
        unresolved.push({ text: `ipcMain.${kind}(${arg}`, file: rel, line });
      }
    }

    const sendRe = /\.send\s*\(\s*IpcChannel\s*\.\s*([A-Z][A-Z0-9_]*)/g;
    while ((m = sendRe.exec(src))) sent.add(m[1]);
  }
  return { registrations, unresolved, sent };
}

function main() {
  const keys = readChannelKeys();
  const keySet = new Set(keys);
  const { registrations, unresolved, sent } = scanMain();

  const byKey = new Map();
  for (const r of registrations) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }

  const duplicates = [...byKey.entries()]
    .filter(([, rs]) => rs.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
  const unknown = registrations
    .filter((r) => !keySet.has(r.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  const unregistered = keys.filter((k) => !byKey.has(k)).sort();
  const sendOnly = unregistered.filter((k) => sent.has(k));
  const unused = unregistered.filter((k) => !sent.has(k));

  const handleCount = registrations.filter((r) => r.kind === 'handle' || r.kind === 'handleOnce').length;
  const onCount = registrations.length - handleCount;

  console.log('IPC チャンネル登録チェック');
  console.log(`  IpcChannel 定義数         : ${keys.length}`);
  console.log(`  登録数 (handle)           : ${handleCount}`);
  console.log(`  登録数 (on)               : ${onCount}`);
  console.log(`  登録済みキー数 (重複除く) : ${byKey.size}`);
  console.log(`  未登録キー数              : ${unregistered.length}`);

  console.log(`\n[エラー] 二重登録: ${duplicates.length}`);
  for (const [key, rs] of duplicates) {
    console.log(`  ${key}: ${rs.map((r) => `${r.kind}@${r.file}:${r.line}`).join(', ')}`);
  }

  console.log(`\n[エラー] IpcChannel に無いキーの登録: ${unknown.length}`);
  for (const r of unknown) console.log(`  ${r.key} (${r.file}:${r.line})`);

  console.log(`\n[警告] チャンネル名を静的に読めない登録: ${unresolved.length}`);
  for (const u of unresolved) console.log(`  ${u.text} (${u.file}:${u.line})`);

  console.log(`\n[情報] 未登録キー (main → renderer への送信あり): ${sendOnly.length}`);
  for (const k of sendOnly) console.log(`  ${k}`);

  console.log(`\n[情報] 未登録キー (main での登録・送信なし): ${unused.length}`);
  for (const k of unused) console.log(`  ${k}`);

  if (duplicates.length > 0 || unknown.length > 0) {
    process.exitCode = 1;
  }
}

main();
