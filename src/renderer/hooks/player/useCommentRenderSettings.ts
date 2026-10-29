import { useMemo } from 'react';
import type { NNDDREComment, NgListItem } from '@shared/types';
import { COMMENT_FONT_FAMILY } from '@shared/constants';
import { applyDefaultColors, isNicoScriptText } from '@shared/utils/nicoScript';
import type { CommentRenderConfig } from '../../components/player/CommentRenderer';
import { useConfig } from '../useConfig';
import { usePermitOnly } from './usePermitOnly';
import { limitSimultaneousComments } from './playerUtils';

/**
 * コメント描画設定 (player.comment* 等) を読み込み、動画上に流すコメント配列と描画設定を返す。
 */
export function useCommentRenderSettings({
  comments,
  pastComments,
  showComments,
  showPastComments,
  ngList
}: {
  ngList: NgListItem[];
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
  /** 投稿者フィルター: 投稿者が設定した置換語で本文を置き換える */
  const [ngUpEnabled] = useConfig<boolean>('player.ngUpEnabled', true);
  /** 許可IDのみ表示 */
  const [permitOnly] = usePermitOnly();

  /** 過去コメント同時表示制限付きコメント配列をメモ化 (不要な rebuildEngine を防ぐ) */
  const renderedComments = useMemo<NNDDREComment[]>(() => {
    const base = showPastComments
      ? limitSimultaneousComments(pastComments, pastCommentMaxCount)
      : comments;
    // owner コマンドコメント (@ジャンプ / ＠デフォルト / ＠CM / ニワン語 等) は画面に流さない
    // ＠デフォルト の既定色は本編の投稿者コメントから集めて適用する
    const filtered = base.filter((c) => !isNicoScriptText(c.text ?? ''));
    const replaced = ngUpEnabled
      ? filtered.map((c) => (c.ngUpText !== undefined ? { ...c, text: c.ngUpText } : c))
      : filtered;
    return applyDefaultColors(replaced, comments);
  }, [showPastComments, pastComments, pastCommentMaxCount, comments, ngUpEnabled]);

  const commentConfig = useMemo<Partial<CommentRenderConfig>>(
    () => ({
      // off はコメント配列を空にせず描画側で止める (配列を変えるとエンジン再構築でちらつく)
      enabled: showComments,
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
      ngStrength,
      ngList,
      permitOnly
    }),
    [
      showComments,
      commentOpacity,
      commentSizeScale,
      commentShowSec,
      commentFontFamily,
      commentBold,
      commentDropShadow,
      commentOutlineIntensity,
      commentAntiAlias,
      commentKeepCA,
      ngStrength,
      ngList,
      permitOnly
    ]
  );

  return { renderedComments, commentConfig };
}
