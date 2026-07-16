import fs from 'node:fs';
import path from 'node:path';

/**
 * 複数バイナリファイルを単純連結。fMP4 セグメントの結合に使う
 * (HLS用のfMP4は init + cmfv/cmfa を直接連結するだけで再生可能)。
 */
export function concatBinary(files: string[], output: string): void {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const writer = fs.openSync(output, 'w');
  try {
    for (const f of files) {
      const data = fs.readFileSync(f);
      fs.writeSync(writer, data, 0, data.length);
    }
  } finally {
    fs.closeSync(writer);
  }
}
