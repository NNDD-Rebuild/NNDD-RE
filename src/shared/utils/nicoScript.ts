import { PremiumColors, StandardColors } from '../types/comment';
import { isVideoId } from './videoId';

/**
 * ニコスクリプトの解釈。元: org/mineap/nInterpreter (ニコスクリプト→ニワン語の変換と、ニワン語の解析)
 *
 * 対応する書式:
 *  - `＠ジャンプ <動画ID|#分:秒|#ラベル> [メッセージ]`
 *  - `＠ジャンプマーカー：<ラベル>`  (このコメントの位置をラベルとして登録)
 *  - `＠デフォルト`  (コメントのコマンド欄の色を、以降の色指定なしコメントの既定色にする)
 *  - ニワン語: `/jump(id:'sm1',msg:'..')` `/seek(vpos:'秒'[,msg:'..'])`
 *    `/addMarker(name:'..',vpos:'ミリ秒')` `/commentColor=0xRRGGBB`
 *
 * 本家との違い: `＠ジャンプ #ラベル` の移動先は秒に揃える (本家はミリ秒を秒として扱い、位置がずれる)。
 */
export type NicoScriptCommand =
  | { kind: 'jump'; videoId: string; msg?: string }
  | { kind: 'seek'; sec: number; msg?: string }
  | { kind: 'seekMarker'; marker: string; msg?: string }
  /** vposMs が無いときは、そのコメント自身の位置 */
  | { kind: 'addMarker'; name: string; vposMs?: number }
  /** colorToken は mail と同じ形式の色 ('red' / '#ff0000')。色指定が無ければ null */
  | { kind: 'setDefaultColor'; colorToken: string | null };

/** 先頭が `＠ジャンプ` `＠デフォルト` `＠CM` またはニワン語のコメント (画面に流さない対象) */
const SCRIPT_TEXT_RE = /^(?:[＠@](?:ジャンプ|デフォルト|[CＣ][MＭ])|\/(?:jump|seek|addMarker|commentColor)\b)/;

/** 画面に流さない命令コメントか (解釈できない書式でも、命令の書き出しなら対象) */
export function isNicoScriptText(text: string): boolean {
  return SCRIPT_TEXT_RE.test(text.trim());
}

const TIME_TARGET_RE = /^[#＃](\d+)[:：](\d+)$/;
const LABEL_TARGET_RE = /^[#＃](\S+)$/;
const MARKER_RE = /^ジャンプマーカー[:：]\s*(\S+)/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** コマンド欄から最初の色指定を取り出す。無ければ null */
export function findColorToken(mail: string): string | null {
  for (const raw of mail.split(/\s+/)) {
    const t = raw.toLowerCase();
    if (StandardColors[t] !== undefined || PremiumColors[t] !== undefined || HEX_COLOR_RE.test(t)) return t;
  }
  return null;
}

/** `key:'value'` の並びを取り出す。キーの無い最初の値は `_` に入れる */
function parseNiwaParams(inner: string): Record<string, string> {
  const params: Record<string, string> = {};
  const re = /(?:(\w+)\s*:\s*)?(['"])(.*?)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) params[m[1] ?? '_'] = m[3];
  return params;
}

function parseNiwa(line: string): NicoScriptCommand | null {
  const color = line.match(/^\/commentColor\s*=\s*0x([0-9a-f]{6})$/i);
  if (color) return { kind: 'setDefaultColor', colorToken: `#${color[1].toLowerCase()}` };

  const call = line.match(/^\/(jump|seek|addMarker)\((.*)\)$/);
  if (!call) return null;
  const p = parseNiwaParams(call[2]);
  const msg = p.msg || undefined;
  switch (call[1]) {
    case 'jump': {
      const videoId = p.id ?? p._;
      return videoId && isVideoId(videoId) ? { kind: 'jump', videoId, msg } : null;
    }
    case 'seek': {
      const sec = Number(p.vpos);
      return p.vpos !== undefined && Number.isFinite(sec) && sec >= 0 ? { kind: 'seek', sec, msg } : null;
    }
    default: {
      const vposMs = Number(p.vpos);
      return p.name && p.vpos !== undefined && Number.isFinite(vposMs)
        ? { kind: 'addMarker', name: p.name, vposMs }
        : null;
    }
  }
}

/** コメントの本文とコマンド欄からニコスクリプトの命令を取り出す。命令でない・解釈できないときは null */
export function parseNicoScript(text: string, mail: string): NicoScriptCommand | null {
  const line = text.replace(/　/g, ' ').trim();
  if (line.startsWith('/')) return parseNiwa(line);
  if (!/^[＠@]/.test(line)) return null;
  const body = line.slice(1).trim();

  // ＠ジャンプマーカー は ＠ジャンプ の前方一致になるので先に判定する
  const marker = body.match(MARKER_RE);
  if (marker) return { kind: 'addMarker', name: marker[1] };

  if (body.startsWith('ジャンプ')) {
    const [, target, msg] = body.split(/\s+/);
    if (!target) return null;
    if (isVideoId(target)) return { kind: 'jump', videoId: target, msg };
    const time = target.match(TIME_TARGET_RE);
    if (time) return { kind: 'seek', sec: Number(time[1]) * 60 + Number(time[2]), msg };
    const label = target.match(LABEL_TARGET_RE);
    if (label) return { kind: 'seekMarker', marker: label[1], msg };
    return null;
  }

  if (body.startsWith('デフォルト')) return { kind: 'setDefaultColor', colorToken: findColorToken(mail) };
  return null;
}

/** ラベル名 → 登録位置 (ミリ秒、昇順) */
export type NicoScriptMarkers = Map<string, number[]>;

/** 投稿者コメントの `addMarker` を全て集める。動画を開いた時点で登録するので、まだ再生していない位置のラベルにも飛べる */
export function collectMarkers(
  items: readonly { cmd: NicoScriptCommand | null; vposMs: number }[]
): NicoScriptMarkers {
  const markers: NicoScriptMarkers = new Map();
  for (const { cmd, vposMs } of items) {
    if (cmd?.kind !== 'addMarker') continue;
    const list = markers.get(cmd.name) ?? [];
    list.push(cmd.vposMs ?? vposMs);
    markers.set(cmd.name, list);
  }
  for (const list of markers.values()) list.sort((a, b) => a - b);
  return markers;
}

/**
 * ラベルの移動先 (ミリ秒) を決める。同名が複数あるときは、現在位置以前で最も新しいものを使い、
 * 無ければ最初のもの (本家は再生が通過した最新のラベルを使う)。無ければ null。
 */
export function resolveMarker(markers: NicoScriptMarkers, name: string, nowMs: number): number | null {
  const list = markers.get(name);
  if (!list || list.length === 0) return null;
  const past = list.filter((v) => v <= nowMs);
  return past.length > 0 ? past[past.length - 1] : list[0];
}
