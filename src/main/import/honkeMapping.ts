import {
  NgListItemType,
  NNDDRESearchSortType,
  NNDDRESearchType,
  RssType,
  type NgListItemTypeValue,
  type NNDDRESearchSortTypeValue,
  type NNDDRESearchTypeValue,
  type RssTypeValue
} from '@shared/types';
import type { ConfigKey } from '../config/ConfigStore';

/** 本家 config.xml のキーを RE の設定へ変換する。変換できない値は null */
interface ConfigMapEntry {
  reKey: ConfigKey;
  convert: (raw: string) => unknown | null;
}

const toBool = (raw: string): boolean | null => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
};

const toNumber = (raw: string): number | null => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
};

const toPort = (raw: string): number | null => {
  const n = toNumber(raw);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

export const HONKE_CONFIG_MAP: Record<string, ConfigMapEntry> = {
  volume: {
    reKey: 'player.volume',
    convert: (raw) => {
      const n = toNumber(raw);
      return n === null ? null : Math.min(1, Math.max(0, n));
    }
  },
  commentAlpha: {
    reKey: 'player.commentOpacity',
    convert: (raw) => {
      const n = toNumber(raw);
      return n === null ? null : Math.min(1, Math.max(0, n / 100));
    }
  },
  fontFamily: { reKey: 'player.commentFontFamily', convert: (raw) => (raw ? raw : null) },
  // 本家の画質は 2(通常)/3(高画質) の2段階。通常は RE の画質指定に対応する値が無いため取り込まない
  playerQuality: { reKey: 'player.defaultQuality', convert: (raw) => (raw === '3' ? 'highest' : null) },
  downloadRetryMaxCount: {
    reKey: 'downloadRetryCount',
    convert: (raw) => {
      const n = toNumber(raw);
      return n === null || n < 0 ? null : Math.floor(n);
    }
  },
  isSaveSearchHistory: { reKey: 'saveSearchHistory', convert: toBool },
  isSaveMyListHistory: { reKey: 'saveMyListHistory', convert: toBool },
  isRepeat: { reKey: 'player.repeat', convert: toBool },
  isShowComment: { reKey: 'player.showComments', convert: toBool },
  isCommentFontBold: { reKey: 'player.commentBold', convert: toBool },
  isAntiAlias: { reKey: 'player.commentAntiAlias', convert: toBool },
  showCommentSec: {
    reKey: 'player.commentShowSeconds',
    convert: (raw) => {
      const n = toNumber(raw);
      return n === null || n <= 0 ? null : n;
    }
  },
  // 本家のサーバー機能 → RE 内蔵HTTPサーバー。LAN公開 (allowExternal) は意図しない公開を避けるため取り込まない
  allowOtherNNDDConnection: { reKey: 'httpServer.enabled', convert: toBool },
  localPort: { reKey: 'httpServer.port', convert: toPort },
  enableShareVideoInfo: { reKey: 'httpServer.allowVideo', convert: toBool },
  enableShareMyListInfo: { reKey: 'httpServer.allowMyList', convert: toBool },
  allowGetOtherNNDDInfo: { reKey: 'remoteNndd.enabled', convert: toBool },
  remoteNNDDAddress: { reKey: 'remoteNndd.address', convert: (raw) => (raw ? raw : null) },
  remoteNNDDPort: { reKey: 'remoteNndd.port', convert: toPort }
};

/** 認証情報など、本家側で暗号化ストアにありインポートできないことが分かっているキー */
export const HONKE_CONFIG_NEVER_IMPORT = new Set(['userName', 'password']);

/** NG 種別 (本家 Comments.NG_KIND_ARRAY)。許可ID は RE に対応が無いので null */
export function mapNgKind(kind: string): NgListItemTypeValue | null {
  switch (kind) {
    case '単語':
      return NgListItemType.WORD;
    case 'コマンド':
      return NgListItemType.COMMAND;
    case '許可ID':
      return null;
    case 'ID':
    default:
      return NgListItemType.USER_ID;
  }
}

export function mapMyListType(type: string): RssTypeValue {
  switch (type) {
    case 'CHANNEL':
      return RssType.CHANNEL;
    case 'COMMUNITY':
      return RssType.COMMUNITY;
    case 'USER_UPLOAD_VIDEO':
      return RssType.USER_UPLOAD_VIDEO;
    case 'MY_LIST':
    default:
      return RssType.MY_LIST;
  }
}

export function mapSearchType(searchType: number): NNDDRESearchTypeValue {
  return searchType === 1 ? NNDDRESearchType.TAG : NNDDRESearchType.KEYWORD;
}

/**
 * 本家の sortType (= sort*2 + order) を RE のソート種別へ。
 * sort: 0投稿日 1再生数 2コメント数 3コメント日時 4マイリスト数 5再生時間 / order: 0降順 1昇順。
 * 対応が無いもの (コメント日時) は投稿日の新しい順にフォールバックし、fallback=true を返す。
 */
export function mapSortType(sortType: number): { value: NNDDRESearchSortTypeValue; fallback: boolean } {
  const sort = Math.floor(sortType / 2);
  const asc = sortType % 2 === 1;
  const S = NNDDRESearchSortType;
  switch (sort) {
    case 0:
      return { value: asc ? S.REGISTERED_AT_ASC : S.REGISTERED_AT_DESC, fallback: false };
    case 1:
      return { value: asc ? S.VIEW_COUNT_ASC : S.VIEW_COUNT_DESC, fallback: false };
    case 2:
      return { value: asc ? S.COMMENT_COUNT_ASC : S.COMMENT_COUNT_DESC, fallback: false };
    case 4:
      return { value: asc ? S.MYLIST_COUNT_ASC : S.MYLIST_COUNT_DESC, fallback: false };
    case 5:
      return { value: asc ? S.LENGTH_ASC : S.LENGTH_DESC, fallback: false };
    default:
      return { value: S.REGISTERED_AT_DESC, fallback: true };
  }
}
