import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { LiveListItem } from '@shared/types';
import { pushToCommentWindow } from './liveCommentUtils';

/** コメントリストの並び替え・再描画をまとめる間隔 (ms) */
const LIST_FLUSH_MS = 300;

export interface LiveCommentList {
  /** コメントリストの全行 (vposMs 昇順。LIST_FLUSH_MS ごとに更新) */
  listItems: LiveListItem[];
  /** コメントリストの全行 (最新。並べ替えは flush 時) */
  listItemsRef: MutableRefObject<LiveListItem[]>;
  /** コメントウィンドウへ未送信の追加分 */
  pendingPushRef: MutableRefObject<LiveListItem[]>;
  /** コメントウィンドウ (フロート) が開いて snapshot 送信済みか */
  commentWindowOpenRef: MutableRefObject<boolean>;
  addListItems: (items: LiveListItem[]) => void;
}

/**
 * 生放送のコメントリスト (コメント + お知らせ) の行を貯めるフック。
 * 開いているコメントウィンドウへは追加分だけ送る。
 */
export function useLiveCommentList(): LiveCommentList {
  /** コメントリストの全行 (vposMs 昇順) と重複判定用キー */
  const listItemsRef = useRef<LiveListItem[]>([]);
  const listKeysRef = useRef(new Set<string>());
  const listFlushTimer = useRef<number | null>(null);
  /** コメントウィンドウ (フロート) が開いて snapshot 送信済みか / 未送信の追加分 */
  const commentWindowOpenRef = useRef(false);
  const pendingPushRef = useRef<LiveListItem[]>([]);
  const [listItems, setListItems] = useState<LiveListItem[]>([]);

  /**
   * コメントリストへ行を追加する。過去コメントと生コメントは同じキーになるので重複は自然に除かれる。
   * 並べ替えと再描画は LIST_FLUSH_MS ごとにまとめる
   */
  const addListItems = useCallback((items: LiveListItem[]) => {
    for (const it of items) {
      if (listKeysRef.current.has(it.key)) continue;
      listKeysRef.current.add(it.key);
      listItemsRef.current.push(it);
      pendingPushRef.current.push(it);
    }
    if (listFlushTimer.current !== null) return;
    listFlushTimer.current = window.setTimeout(() => {
      listFlushTimer.current = null;
      listItemsRef.current.sort((a, b) => a.vposMs - b.vposMs);
      setListItems([...listItemsRef.current]);
      // コメントウィンドウへは追加分だけ送る
      if (commentWindowOpenRef.current && pendingPushRef.current.length > 0) {
        pushToCommentWindow({ type: 'append', items: pendingPushRef.current });
      }
      pendingPushRef.current = [];
    }, LIST_FLUSH_MS);
  }, []);

  return { listItems, listItemsRef, pendingPushRef, commentWindowOpenRef, addListItems };
}
