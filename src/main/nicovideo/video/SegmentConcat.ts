import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * 複数バイナリファイルを単純連結。fMP4 セグメントの結合に使う
 * (HLS用のfMP4は init + cmfv/cmfa を直接連結するだけで再生可能)。
 *
 * 長時間の生放送録画では数GBになるので、同期読み書きで main プロセスを止めないよう、ストリームで非同期に連結する。
 */
export async function concatBinary(files: string[], output: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const out = fs.createWriteStream(output);
  try {
    for (const f of files) {
      // end: false で出力を開いたまま、ファイルを順に流し込む
      await pipeline(fs.createReadStream(f), out, { end: false });
    }
  } catch (e) {
    out.destroy();
    throw e;
  }
  await new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.end(resolve);
  });
}
