import fs from 'node:fs';
import path from 'node:path';
import type { StreamJson, VariantStreamData } from '@shared/types';

/**
 * Niconicome 互換の stream.json を出力する。
 *
 * 元: Niconicome V3 の StreamJsonHandler.cs
 *
 * このファイルはダウンロード結果フォルダに保存される。
 *  - 解像度・ビットレート
 *  - AES鍵 (base64) と IV
 *  - 映像/音声 init ファイル名
 *  - セグメント名と長さ
 *
 * これにより同じツール (Niconicome等) と相互運用できる。
 */
export class StreamJsonWriter {
  static write(outDir: string, data: VariantStreamData): void {
    const dest = path.join(outDir, 'stream.json');
    const json: StreamJson = { streams: [data] };
    fs.writeFileSync(dest, JSON.stringify(json, null, 2), 'utf-8');
  }

  static read(outDir: string): StreamJson | null {
    const p = path.join(outDir, 'stream.json');
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      return null;
    }
  }
}
