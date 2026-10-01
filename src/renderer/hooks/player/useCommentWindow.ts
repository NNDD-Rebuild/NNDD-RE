import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { NNDDREComment } from '@shared/types';
import { IpcChannel } from '@shared/types';
import type { PlayInfo } from './playerUtils';

/**
 * コメント一覧ウィンドウ (別ウィンドウ) との連携。
 *  - コメント配列のプッシュ
 *  - ウィンドウからのシーク要求 / 過去コメント配列の受信
 *  - 動画読み込み完了時の自動オープン (設定 player.commentListDisplay = 'window')
 *
 * 再生位置のプッシュ (COMMENT_WINDOW_TIME) は usePlaybackTicker が行う。
 *
 * @returns コメント一覧ウィンドウを開く関数
 */
export function useCommentWindow({
  comments,
  localCommentXmlPath,
  localIchibaHtmlPath,
  playInfoRef,
  videoElementRef,
  setPastComments,
  setShowPastComments,
  loading,
  src,
  audioOnly,
  commentListDisplay,
  commentWindowAutoOpen,
  isWebPlayer
}: {
  comments: NNDDREComment[];
  localCommentXmlPath: string | undefined;
  localIchibaHtmlPath: string | undefined;
  playInfoRef: MutableRefObject<PlayInfo | null>;
  videoElementRef: MutableRefObject<HTMLVideoElement | null>;
  setPastComments: Dispatch<SetStateAction<NNDDREComment[]>>;
  setShowPastComments: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
  src: string;
  audioOnly: boolean;
  commentListDisplay: 'tab' | 'window';
  commentWindowAutoOpen: boolean;
  isWebPlayer: boolean;
}): () => void {
  // 値は参照していないが、オープン成功時の再描画を元の実装どおり維持するため残している
  const [, setCommentWindowOpen] = useState(false);

  // comments 変更時にプッシュ (ウィンドウが開いていれば main が転送)
  useEffect(() => {
    window.nndd.send(IpcChannel.COMMENT_WINDOW_PUSH, comments);
  }, [comments]);

  // コメントウィンドウからのシーク要求を受信
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.PLAYER_SEEK,
      (timeSec: number) => {
        const v = videoElementRef.current;
        if (v) v.currentTime = timeSec;
      }
    );
    return off;
  }, []);

  // コメントウィンドウからの過去コメント配列を受信
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.PLAYER_PAST_COMMENTS,
      (cs: NNDDREComment[] | null) => {
        if (cs === null || cs.length === 0) {
          setPastComments([]);
          setShowPastComments(false);
        } else {
          setPastComments(cs);
          setShowPastComments(true);
        }
      }
    );
    return off;
  }, []);

  const commentsRef = useRef<NNDDREComment[]>([]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  const localCommentXmlPathRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    localCommentXmlPathRef.current = localCommentXmlPath;
  }, [localCommentXmlPath]);

  const localIchibaHtmlPathRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    localIchibaHtmlPathRef.current = localIchibaHtmlPath;
  }, [localIchibaHtmlPath]);

  const openCommentWindow = useCallback((): void => {
    const info = playInfoRef.current;
    window.nndd
      .invoke(IpcChannel.COMMENT_WINDOW_OPEN, {
        videoId: info?.videoId ?? '',
        title: info?.title ?? '',
        comments: commentsRef.current,
        localCommentXmlPath: localCommentXmlPathRef.current,
        ichibaHtmlPath: localIchibaHtmlPathRef.current
      })
      .then(() => setCommentWindowOpen(true))
      .catch(() => {});
  }, []); // commentsRef は ref なので deps 不要

  // 動画が変わったとき (loading 完了 + src セット) に自動オープン
  // (上の ref 同期 effect より後に置くこと。openCommentWindow は ref の最新値を読む)
  const autoOpenDoneRef = useRef(false);
  useEffect(() => {
    if (loading || !src) {
      autoOpenDoneRef.current = false; // リセット: 次の動画でまた発火可能に
      return;
    }
    if (autoOpenDoneRef.current) return;
    autoOpenDoneRef.current = true;
    if (commentListDisplay === 'window' && !audioOnly && !isWebPlayer) {
      openCommentWindow();
    }
  }, [loading, src, commentListDisplay, commentWindowAutoOpen, openCommentWindow, audioOnly]);

  return openCommentWindow;
}
