import { useMemo } from 'react';
import type { NNDDREComment } from '@shared/types';
import { COMMENT_FONT_FAMILY } from '@shared/constants';
import type { CommentRenderConfig } from '../../components/player/CommentRenderer';
import { useConfig } from '../useConfig';
import { limitSimultaneousComments } from './playerUtils';

/**
 * コメント描画設定 (player.comment* 等) を読み込み、動画上に流すコメント配列と描画設定を返す。
 */
export function useCommentRenderSettings({
  comments,
  pastComments,
  showComments,
  showPastComments
}: {
  comments: NNDDREComment[];
  pastComments: NNDDREComment[];
  showComments: boolean;
  showPastComments: boolean;
}): {
  renderedComments: NNDDREComment[];
  commentConfig: Partial<CommentRenderConfig>;
} {
  const [ngStrength] = useConfig<'weak' | 'medium' | 'strong'>('player.ngStrength', 'medium');
  const [commentOpacity] = useConfig<number>('player.commentOpacity', 1);
  const [commentSizeScale] = useConfig<number>('player.commentSizeScale', 1);
  const [commentShowSec] = useConfig<number>('player.commentShowSeconds', 3);
  const [commentFontFamily] = useConfig<string>(
    'player.commentFontFamily',
    COMMENT_FONT_FAMILY
  );
  const [commentBold] = useConfig<boolean>('player.commentBold', false);
  const [commentDropShadow] = useConfig<boolean>(
    'player.commentDropShadow',
    true
  );
  const [commentOutlineIntensity] = useConfig<'light' | 'normal'>(
    'player.commentOutlineIntensity',
    'light'
  );
  const [commentAntiAlias] = useConfig<boolean>(
    'player.commentAntiAlias',
    true
  );
  const [commentKeepCA] = useConfig<boolean>(
    'player.commentKeepCA',
    true
  );
  /** 過去コメント時の同時描画制限 (0=無制限) */
  const [pastCommentMaxCount] = useConfig<number>('player.pastCommentMaxCount', 0);

  /** 過去コメント同時表示制限付きコメント配列をメモ化 (不要な rebuildEngine を防ぐ) */
  const renderedComments = useMemo<NNDDREComment[]>(() => {
    if (!showComments) return [];
    const base = showPastComments
      ? limitSimultaneousComments(pastComments, pastCommentMaxCount)
      : comments;
    // owner コマンドコメント (@ジャンプ / ＠CM 等) は画面に流さない
    return base.filter((c) => !/^[＠@](ジャンプ|[CＣ][MＭ])/.test(c.text ?? ''));
  }, [showComments, showPastComments, pastComments, pastCommentMaxCount, comments]);

  const commentConfig = useMemo<Partial<CommentRenderConfig>>(
    () => ({
      opacity: commentOpacity,
      sizeScale: commentSizeScale,
      showSecNaka: commentShowSec,
      showSecFixed: commentShowSec,
      fontFamily: commentFontFamily,
      bold: commentBold,
      dropShadow: commentDropShadow,
      outlineIntensity: commentOutlineIntensity,
      antiAlias: commentAntiAlias,
      keepCA: commentKeepCA,
      ngStrength
    }),
    [
      commentOpacity,
      commentSizeScale,
      commentShowSec,
      commentFontFamily,
      commentBold,
      commentDropShadow,
      commentOutlineIntensity,
      commentAntiAlias,
      commentKeepCA,
      ngStrength
    ]
  );

  return { renderedComments, commentConfig };
}
