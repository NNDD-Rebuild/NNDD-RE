import type { LiveCommentWindowMessage, NNDDREComment } from '@shared/types';
import { CommentPosition, IpcChannel } from '@shared/types';

/** 生放送プレイヤー → コメントウィンドウ (main が中継) */
export function pushToCommentWindow(msg: LiveCommentWindowMessage): void {
  window.nndd.send(IpcChannel.LIVE_COMMENT_WINDOW_PUSH, msg);
}

/** niconicomments の流れコメントは vpos の 1 秒前に右端から出現する */
export const NAKA_LEAD_MS = 1000;

/** 過去コメントと生コメントの重複判定キー (vpos は描画用に調整する前の値) */
export function commentKey(c: NNDDREComment): string {
  return `${c.no}-${c.userId}-${c.vposMs}`;
}

/**
 * 生放送コメントの vpos は投稿した瞬間の時刻なので、流れコメントはその時刻に右端から出るのが正しい。
 * niconicomments は vpos の 1 秒前に出現させるため、流れコメントだけ出現時刻分ずらす
 * (ue/shita の固定コメントは vpos ちょうどに表示されるのでそのまま)。
 */
export function alignNaka(c: NNDDREComment): NNDDREComment {
  return c.positionCommand === CommentPosition.NAKA ? { ...c, vposMs: c.vposMs + NAKA_LEAD_MS } : c;
}
