import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { LiveListItem, LiveStartResult, NNDDREComment } from '@shared/types';
import { CommentPosition } from '@shared/types';
import type { CommentRenderer } from '../../components/player/CommentRenderer';
import { alignNaka, commentKey, NAKA_LEAD_MS } from './liveCommentUtils';

/**
 * 全件取得中、描画エンジンへ過去コメントを反映する間隔 (ms)。
 * 反映 (setComments) は毎回エンジンの作り直しになるので、取得中は間引いて再生を邪魔しない
 */
const ARCHIVE_APPLY_INTERVAL_MS = 5000;
/**
 * 届いた時点で表示位置を過ぎているコメントを「今」に寄せる許容幅 (ms)。
 * これより古いものは元の位置のまま = 画面には流さない。
 */
const LATE_COMMENT_WINDOW_MS = 10_000;
/**
 * 「今」に寄せる対象は、投稿からこの時間 (ms) 以内に届いたコメント (= リアルタイムの生コメント) だけ。
 * 接続直後にコメントサーバーからまとめて届く直前区間の分まで寄せると、開いた瞬間に一斉に流れてしまう
 */
const REALTIME_ARRIVAL_MS = 5_000;

export interface LiveCommentFeedOptions {
  rendererRef: MutableRefObject<CommentRenderer | null>;
  /** 今映っている映像の vpos (1/100秒) を返す関数 */
  currentVposRef: MutableRefObject<() => number>;
  isTimeshiftRef: MutableRefObject<boolean>;
  /** 追っかけ再生へ切り替えられるか。巻き戻して流す分があるので、生コメントを件数上限で捨てない */
  chasePlayAvailableRef: MutableRefObject<boolean>;
  commentFetchModeRef: MutableRefObject<LiveStartResult['commentFetchMode']>;
  addListItems: (items: LiveListItem[]) => void;
  setArchiveLoading: Dispatch<SetStateAction<boolean>>;
}

export interface LiveCommentFeed {
  /** LiveEvent `comments` (生コメント) の処理 */
  handleLiveComments: (comments: NNDDREComment[]) => void;
  /** LiveEvent `archiveComments` (過去コメント) の処理 */
  handleArchiveComments: (comments: NNDDREComment[], done: boolean) => void;
}

/**
 * 生放送で届くコメント (生コメント・過去コメント) を描画エンジンとコメントリストへ流すフック。
 * 生コメントと過去コメントの重複を除き、届くのが遅れた生コメントは「今」に寄せて流す。
 */
export function useLiveCommentFeed({
  rendererRef,
  currentVposRef,
  isTimeshiftRef,
  chasePlayAvailableRef,
  commentFetchModeRef,
  addListItems,
  setArchiveLoading
}: LiveCommentFeedOptions): LiveCommentFeed {
  /** 生コメントの投稿→受信の最小の遅れ (ms)。PC とサーバーの時計のずれの推定に使う */
  const minArrivalDelayRef = useRef(Infinity);
  /** 受信した生コメント (描画用に調整済み) と、過去コメントとの重複判定キー */
  const liveAddedRef = useRef<NNDDREComment[]>([]);
  const liveKeysRef = useRef(new Set<string>());
  /** 過去コメント (取得順)。描画エンジンへは並べ替えてから渡す */
  const archiveRef = useRef<NNDDREComment[]>([]);
  const archiveFlushTimer = useRef<number | null>(null);

  const handleLiveComments = useCallback(
    (comments: NNDDREComment[]): void => {
      // コメントサーバーからの到着は投稿時刻より遅れるため、そのまま渡すと
      // 「既に流れ始めていたはずの位置」= 画面の途中から出現する。
      // 既に出現済みのはずのものは、出現時刻 (vpos - 1秒) が今になるよう寄せて右端から流す
      const nowMs = currentVposRef.current() * 10;
      const arrivedAtMs = Date.now();
      // 投稿→受信の遅れ。PC の時計がずれていても判定できるよう、これまでの最小の遅れを基準にする
      for (const c of comments) {
        if (c.date > 0) minArrivalDelayRef.current = Math.min(minArrivalDelayRef.current, arrivedAtMs - c.date * 1000);
      }
      const adjusted = comments.map(alignNaka).map((c) => {
        // 投稿から時間が経って届いたもの (直前区間のまとめ読み等) は元の時刻のまま
        const realtime =
          c.date > 0 && arrivedAtMs - c.date * 1000 - minArrivalDelayRef.current <= REALTIME_ARRIVAL_MS;
        // 出現時刻が今になる vpos (流れコメントは 1 秒前に出現するので +1 秒)
        const appearMs = nowMs + (c.positionCommand === CommentPosition.NAKA ? NAKA_LEAD_MS : 0);
        return realtime && c.vposMs < appearMs && appearMs - c.vposMs <= LATE_COMMENT_WINDOW_MS
          ? { ...c, vposMs: Math.ceil(appearMs) }
          : c;
      });
      // 追っかけ再生に切り替えられるときは過去コメントも保持しているため件数上限で捨てない
      rendererRef.current?.addComments(adjusted, chasePlayAvailableRef.current ? Infinity : undefined);
      // 過去コメントとの突き合わせ用に受信分を覚えておく
      liveAddedRef.current.push(...adjusted);
      for (const c of comments) liveKeysRef.current.add(commentKey(c));
      addListItems(comments.map((c) => ({ key: commentKey(c), vposMs: c.vposMs, comment: c })));
    },
    [currentVposRef, rendererRef, chasePlayAvailableRef, addListItems]
  );

  const handleArchiveComments = useCallback(
    (comments: NNDDREComment[], done: boolean): void => {
      if (comments.length > 0) archiveRef.current = archiveRef.current.concat(comments);
      if (done) setArchiveLoading(false);
      addListItems(comments.map((c) => ({ key: commentKey(c), vposMs: c.vposMs, comment: c })));
      // ページ毎に届くので、まとめてからエンジンへ渡す (setComments は毎回作り直しになる)
      if (archiveFlushTimer.current !== null) window.clearTimeout(archiveFlushTimer.current);
      archiveFlushTimer.current = window.setTimeout(() => {
        archiveFlushTimer.current = null;
        // 周辺取得では同じ範囲を重ねて取得することがあるので重複を除く
        const unique = new Map(archiveRef.current.map((c) => [commentKey(c), c]));
        const sorted = [...unique.values()].sort((a, b) => a.vposMs - b.vposMs);
        archiveRef.current = sorted;
        if (isTimeshiftRef.current) {
          rendererRef.current?.setComments(sorted.map(alignNaka));
        } else {
          // 放送中: 開いた時点より前のコメント + 受信済みの生コメント (重複は生コメント側を優先)
          const past = sorted.filter((c) => !liveKeysRef.current.has(commentKey(c))).map(alignNaka);
          rendererRef.current?.setComments([...past, ...liveAddedRef.current]);
        }
      }, done ? 0 : commentFetchModeRef.current === 'seek' ? 300 : ARCHIVE_APPLY_INTERVAL_MS);
    },
    [setArchiveLoading, addListItems, isTimeshiftRef, rendererRef, commentFetchModeRef]
  );

  return { handleLiveComments, handleArchiveComments };
}
