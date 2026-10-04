import { XMLParser } from 'fast-xml-parser';

/** 本家NNDD (AIR版) の永続化ファイルの純粋なパーサ。ファイルI/Oは行わない */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    name === 'item' ||
    name === 'tag' ||
    name === 'myList' ||
    name === 'searchItem' ||
    name === 'historyItem'
});

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    return t === undefined ? '' : String(t);
  }
  return String(v);
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null || (v as unknown) === '') return [];
  return Array.isArray(v) ? v : [v];
}

type Node = Record<string, unknown>;

function root(xml: string, name: string): Node {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const r = doc[name];
  return r && typeof r === 'object' ? (r as Node) : {};
}

/** config.xml: `<config><key>value</key>...</config>` */
export function parseConfigXml(xml: string): Record<string, string> {
  const r = root(xml, 'config');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k.startsWith('@_') || k === '#text') continue;
    out[k] = str(v);
  }
  return out;
}

export interface HonkeNgItem {
  kind: string;
  value: string;
}

/** ngList.xml: `<ng><item kind="...">encoded</item></ng>` */
export function parseNgListXml(xml: string): HonkeNgItem[] {
  const r = root(xml, 'ng');
  return asArray(r.item as Node | Node[]).map((it) => ({
    kind: typeof it === 'object' ? str(it['@_kind']) : '',
    value: safeDecode(str(it))
  }));
}

/** ngTags.xml: `<ngTags><tag>encoded</tag></ngTags>` */
export function parseNgTagsXml(xml: string): string[] {
  const r = root(xml, 'ngTags');
  return asArray(r.tag as unknown[]).map((t) => safeDecode(str(t)));
}

export interface HonkeMyList {
  name: string;
  url: string;
  type: string;
  isDir: boolean;
}

/** myLists.xml: フォルダは myList のネスト。階層は平坦化して返す */
export function parseMyListsXml(xml: string): HonkeMyList[] {
  const out: HonkeMyList[] = [];
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      const isDir = str(n['@_isDir']) === 'true';
      out.push({
        name: safeDecode(str(n['@_name'])),
        url: safeDecode(str(n['@_url'])),
        type: str(n['@_type']),
        isDir
      });
      if (n.myList) walk(asArray(n.myList as Node | Node[]));
    }
  };
  walk(asArray(root(xml, 'myLists').myList as Node | Node[]));
  return out;
}

export interface HonkeSearchItem {
  name: string;
  word: string;
  sortType: number;
  searchType: number;
  isDir: boolean;
}

/** searchItems.xml: フォルダは平坦化 */
export function parseSearchItemsXml(xml: string): HonkeSearchItem[] {
  const out: HonkeSearchItem[] = [];
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      out.push({
        name: safeDecode(str(n['@_name'])),
        word: safeDecode(str(n['@_searchWord'])),
        sortType: Number.parseInt(str(n['@_sortType']), 10) || 0,
        searchType: Number.parseInt(str(n['@_searchType']), 10) || 0,
        isDir: str(n['@_isDir']) === 'true'
      });
      if (n.searchItem) walk(asArray(n.searchItem as Node | Node[]));
    }
  };
  walk(asArray(root(xml, 'searchItems').searchItem as Node | Node[]));
  return out;
}

export interface HonkeHistoryItem {
  thumbUrl: string;
  videoName: string;
  /** epoch ms */
  playDate: number;
  url: string;
}

/** history.xml */
export function parseHistoryXml(xml: string): HonkeHistoryItem[] {
  const r = root(xml, 'history');
  return asArray(r.historyItem as Node | Node[]).map((n) => ({
    thumbUrl: safeDecode(str(n['@_thumbUrl'])),
    videoName: safeDecode(str(n['@_videoName'])),
    playDate: Number(str(n['@_playDate'])) || 0,
    url: safeDecode(str(n['@_url']))
  }));
}

export interface HonkeM3uEntry {
  title: string;
  lengthSec: number;
  path: string;
}

/** playList/*.m3u: `#EXTINF:sec,name` の次行がパス */
export function parseM3u(text: string): HonkeM3uEntry[] {
  const out: HonkeM3uEntry[] = [];
  let title = '';
  let lengthSec = 0;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const body = line.slice('#EXTINF:'.length);
      const comma = body.indexOf(',');
      lengthSec = Number.parseFloat(comma >= 0 ? body.slice(0, comma) : body) || 0;
      title = comma >= 0 ? body.slice(comma + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    out.push({ title, lengthSec: Math.max(0, lengthSec), path: line });
    title = '';
    lengthSec = 0;
  }
  return out;
}

export interface HonkeDownloadItem {
  videoUrl: string;
  videoName: string;
}

/** downloadList.xml: ルート直下の各要素が videoUrl / videoName を子に持つ */
export function parseDownloadListXml(xml: string): HonkeDownloadItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rootNode = Object.values(doc).find((v) => v && typeof v === 'object') as Node | undefined;
  if (!rootNode) return [];
  const out: HonkeDownloadItem[] = [];
  for (const v of Object.values(rootNode)) {
    for (const n of asArray(v as Node | Node[])) {
      if (!n || typeof n !== 'object' || n.videoUrl === undefined) continue;
      out.push({
        videoUrl: safeDecode(str(n.videoUrl)),
        videoName: safeDecode(str(n.videoName))
      });
    }
  }
  return out;
}
