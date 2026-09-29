import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { NicowariContent } from '@shared/types';
import { createLogger } from '../util/Logger';

const log = createLogger('NicowariSwf');

/** ファイル名にこの文字列を含む .swf をニコ割素材とみなす */
export const NICOWARI_MARK = '[Nicowari]';

// SWF タグコード
const TAG_END = 0;
const TAG_DEFINE_BITS = 6;
const TAG_JPEG_TABLES = 8;
const TAG_DEFINE_SOUND = 14;
const TAG_SOUND_STREAM_HEAD = 18;
const TAG_SOUND_STREAM_BLOCK = 19;
const TAG_DEFINE_BITS_JPEG2 = 21;
const TAG_DEFINE_BITS_JPEG3 = 35;
const TAG_SOUND_STREAM_HEAD2 = 45;
const TAG_DEFINE_BITS_JPEG4 = 90;

/** SWF の音声圧縮形式 (SoundFormat) */
const SOUND_FORMAT_MP3 = 2;
const SOUND_FORMAT_NAMES: Record<number, string> = {
  0: 'PCM (native)',
  1: 'ADPCM',
  2: 'MP3',
  3: 'PCM',
  4: 'Nellymoser 16kHz',
  5: 'Nellymoser 8kHz',
  6: 'Nellymoser',
  11: 'Speex'
};

interface SwfTag {
  code: number;
  body: Buffer;
}

/**
 * 動画ファイルと同じフォルダにあるニコ割SWFを探す。
 * 命名規則: `<動画ファイル名(拡張子なし)>[Nicowari][<ニコ割の動画ID>].swf`
 */
export function findNicowariFiles(videoPath: string, dirEntries: string[]): string[] {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const prefix = `${baseName}${NICOWARI_MARK}`;
  return dirEntries
    .filter((name) => name.startsWith(prefix) && name.toLowerCase().endsWith('.swf'))
    .sort()
    .map((name) => path.join(dir, name));
}

/** SWF を展開して、ヘッダ (ステージサイズ等) とタグ列を返す */
function readSwf(buf: Buffer): { width: number; height: number; frameRate: number; frameCount: number; tags: SwfTag[] } {
  const sig = buf.toString('ascii', 0, 3);
  let data: Buffer;
  if (sig === 'FWS') {
    data = buf.subarray(8);
  } else if (sig === 'CWS') {
    data = zlib.inflateSync(buf.subarray(8));
  } else if (sig === 'ZWS') {
    throw new Error('LZMA圧縮のSWFには対応していません');
  } else {
    throw new Error('SWFファイルではありません');
  }

  // RECT: 先頭5bitがフィールド長。Xmin, Xmax, Ymin, Ymax (twips)
  const nBits = data[0] >> 3;
  const readBits = (bitOffset: number, count: number): number => {
    let v = 0;
    for (let i = 0; i < count; i++) {
      const bit = bitOffset + i;
      v = (v << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    // 符号付き (SB)
    if (count > 0 && v & (1 << (count - 1))) v -= 1 << count;
    return v;
  };
  const xMin = readBits(5, nBits);
  const xMax = readBits(5 + nBits, nBits);
  const yMin = readBits(5 + nBits * 2, nBits);
  const yMax = readBits(5 + nBits * 3, nBits);
  let pos = Math.ceil((5 + nBits * 4) / 8);
  const frameRate = data.readUInt16LE(pos) / 256;
  const frameCount = data.readUInt16LE(pos + 2);
  pos += 4;

  const tags: SwfTag[] = [];
  while (pos + 2 <= data.length) {
    const codeAndLength = data.readUInt16LE(pos);
    pos += 2;
    const code = codeAndLength >> 6;
    let len = codeAndLength & 0x3f;
    if (len === 0x3f) {
      if (pos + 4 > data.length) break;
      len = data.readUInt32LE(pos);
      pos += 4;
    }
    if (pos + len > data.length) break;
    tags.push({ code, body: data.subarray(pos, pos + len) });
    pos += len;
    if (code === TAG_END) break;
  }

  return {
    width: Math.round((xMax - xMin) / 20),
    height: Math.round((yMax - yMin) / 20),
    frameRate,
    frameCount,
    tags
  };
}

/**
 * Flash の JPEG データの補正。古いSWFは先頭に誤った EOI+SOI (FF D9 FF D8) が付いていることがあり、
 * ブラウザがデコードに失敗するため取り除く。
 */
function fixJpeg(data: Buffer): Buffer {
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd9 && data[2] === 0xff && data[3] === 0xd8) {
    return data.subarray(4);
  }
  return data;
}

/** 画像データの形式を先頭バイトから判定する (DefineBitsJPEG2以降は PNG/GIF も入りうる) */
function imageMime(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

/** 画像タグから画像を取り出す。最もサイズの大きい画像をニコ割の本体とみなす */
function extractImage(tags: SwfTag[]): { mime: string; data: Buffer } | null {
  let jpegTables: Buffer | null = null;
  let best: { mime: string; data: Buffer } | null = null;
  for (const tag of tags) {
    let data: Buffer | null = null;
    switch (tag.code) {
      case TAG_JPEG_TABLES:
        jpegTables = tag.body;
        break;
      case TAG_DEFINE_BITS: {
        // JPEGTables (量子化・ハフマン表) と画像本体を 1 つの JPEG に結合する
        const body = tag.body.subarray(2);
        if (jpegTables && jpegTables.length > 4) {
          const tables = fixJpeg(jpegTables);
          const head = tables.subarray(0, tables.length - 2); // 末尾の EOI を除く
          const rest = body[0] === 0xff && body[1] === 0xd8 ? body.subarray(2) : body; // 先頭の SOI を除く
          data = Buffer.concat([head, fixJpeg(rest)]);
        } else {
          data = fixJpeg(body);
        }
        break;
      }
      case TAG_DEFINE_BITS_JPEG2:
        data = fixJpeg(tag.body.subarray(2));
        break;
      case TAG_DEFINE_BITS_JPEG3: {
        // アルファチャンネルは使わず、JPEG 部分だけを取り出す
        const alphaOffset = tag.body.readUInt32LE(2);
        data = fixJpeg(tag.body.subarray(6, 6 + alphaOffset));
        break;
      }
      case TAG_DEFINE_BITS_JPEG4: {
        const alphaOffset = tag.body.readUInt32LE(2);
        data = fixJpeg(tag.body.subarray(8, 8 + alphaOffset));
        break;
      }
    }
    if (!data) continue;
    const mime = imageMime(data);
    if (mime && (!best || data.length > best.data.length)) {
      best = { mime, data };
    }
  }
  return best;
}

/**
 * 音声タグから MP3 を取り出す。ストリーミング音声 (SoundStreamBlock) を優先し、
 * 無ければ最初の効果音 (DefineSound) を使う。
 */
function extractAudio(tags: SwfTag[]): { mp3: Buffer | null; unsupportedFormat: string | null } {
  let streamFormat: number | null = null;
  const streamChunks: Buffer[] = [];
  let firstSound: Buffer | null = null;
  let unsupportedFormat: string | null = null;

  for (const tag of tags) {
    switch (tag.code) {
      case TAG_SOUND_STREAM_HEAD:
      case TAG_SOUND_STREAM_HEAD2:
        if (tag.body.length >= 2) streamFormat = tag.body[1] >> 4;
        break;
      case TAG_SOUND_STREAM_BLOCK:
        // MP3 の場合: SampleCount(UI16) + SeekSamples(SI16) + MP3 フレーム
        if (streamFormat === SOUND_FORMAT_MP3 && tag.body.length > 4) {
          streamChunks.push(tag.body.subarray(4));
        }
        break;
      case TAG_DEFINE_SOUND: {
        if (firstSound || tag.body.length < 7) break;
        const format = tag.body[2] >> 4;
        if (format === SOUND_FORMAT_MP3) {
          // SoundId(UI16) + フラグ(UI8) + SampleCount(UI32) + SeekSamples(SI16) + MP3 フレーム
          firstSound = tag.body.subarray(9);
        } else {
          unsupportedFormat ??= SOUND_FORMAT_NAMES[format] ?? `format=${format}`;
        }
        break;
      }
    }
  }

  if (streamChunks.length > 0) return { mp3: Buffer.concat(streamChunks), unsupportedFormat: null };
  if (firstSound) return { mp3: firstSound, unsupportedFormat: null };
  if (streamFormat !== null && streamFormat !== SOUND_FORMAT_MP3) {
    unsupportedFormat = SOUND_FORMAT_NAMES[streamFormat] ?? `format=${streamFormat}`;
  }
  return { mp3: null, unsupportedFormat };
}

/**
 * ニコ割SWFから画像と音声を取り出す。
 * Flash (ActionScript やベクター図形のアニメーション) は再現しない。
 * 当時のニコ割は「静止画 + MP3 音声」だけで構成されたものが多いため、それを再生する。
 */
export function readNicowariSwf(filePath: string): NicowariContent {
  const swf = readSwf(fs.readFileSync(filePath));
  const image = extractImage(swf.tags);
  const audio = extractAudio(swf.tags);
  log.debug('nicowari parsed:', filePath, {
    size: `${swf.width}x${swf.height}`,
    frames: swf.frameCount,
    fps: swf.frameRate,
    image: image ? `${image.mime} ${image.data.length}B` : null,
    mp3: audio.mp3 ? `${audio.mp3.length}B` : null,
    unsupportedAudio: audio.unsupportedFormat
  });
  return {
    width: swf.width,
    height: swf.height,
    durationSec: swf.frameRate > 0 ? swf.frameCount / swf.frameRate : 0,
    image: image ? { mime: image.mime, data: new Uint8Array(image.data) } : null,
    audio: audio.mp3 ? { mime: 'audio/mpeg', data: new Uint8Array(audio.mp3) } : null,
    unsupportedAudioFormat: audio.unsupportedFormat
  };
}
