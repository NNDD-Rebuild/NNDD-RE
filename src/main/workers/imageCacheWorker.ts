import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

interface WriteRequest {
  id: number;
  filePath: string;
  buffer: ArrayBuffer;
  maxBytes: number;
}

interface WriteResponse {
  id: number;
  ok: boolean;
  error?: string;
  evicted?: string[];
}

function evictIfNeeded(dir: string, maxBytes: number): string[] {
  if (maxBytes <= 0) return [];
  const evicted: string[] = [];
  try {
    const files = fs.readdirSync(dir);
    const entries = files.map((f) => {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      return { path: p, name: f, size: stat.size, mtime: stat.mtimeMs };
    });
    entries.sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((s, e) => s + e.size, 0);
    for (const entry of entries) {
      if (total <= maxBytes) break;
      try {
        fs.unlinkSync(entry.path);
        evicted.push(entry.name);
        total -= entry.size;
      } catch {}
    }
  } catch {}
  return evicted;
}

parentPort?.on('message', (msg: WriteRequest) => {
  try {
    fs.writeFileSync(msg.filePath, Buffer.from(msg.buffer));
    const evicted = evictIfNeeded(path.dirname(msg.filePath), msg.maxBytes);
    const res: WriteResponse = { id: msg.id, ok: true, evicted };
    parentPort?.postMessage(res);
  } catch (e) {
    const res: WriteResponse = { id: msg.id, ok: false, error: String(e) };
    parentPort?.postMessage(res);
  }
});
