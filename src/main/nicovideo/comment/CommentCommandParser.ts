import {
  CommentPosition,
  type CommentPositionValue,
  CommentSize,
  type CommentSizeValue,
  StandardColors,
  PremiumColors
} from '@shared/types';

/**
 * コメントの mail / commands 文字列をパースして、
 * 色・サイズ・位置・ボタンコマンド (@CMなど) を抽出する。
 *
 * 元: src/org/mineap/nndd/player/comment/Command.as
 */
export interface ParsedCommentCommand {
  /** テキスト塗り色 */
  color: number;
  /**
   * 二色コマンド時の輪郭色。
   * 命名色 (blue2 等) + 16進色 (#XXXXXX) が共存する場合:
   *   命名色 → fill、16進 → stroke (ニコニコ二色コメント仕様)
   */
  strokeColor?: number;
  size: CommentSizeValue;
  position: CommentPositionValue;
  /** 184 / 永続化系の特殊コマンド (フィルタ等で使用) */
  rawCommands: string[];
}

const DEFAULT_COLOR = 0xffffff;

export class CommentCommandParser {
  /**
   * V3 API は `commands: ["red", "shita"]` 形式。
   * V2 API は `mail: "red shita big"` のような単一文字列。
   * 両方を受け取れる形にする。
   */
  static parse(
    mailOrCommands: string | string[] | undefined,
    isPremium: boolean
  ): ParsedCommentCommand {
    const tokens = this.toTokens(mailOrCommands);
    let fillColor = DEFAULT_COLOR;
    let strokeColor: number | undefined;
    let hasNamedColor = false;
    let hasFillHex = false;
    let size: CommentSizeValue = CommentSize.MEDIUM;
    let position: CommentPositionValue = CommentPosition.NAKA;
    const raw: string[] = [];

    for (const tRaw of tokens) {
      const t = tRaw.toLowerCase();
      raw.push(t);

      // 位置
      if (t === 'naka') position = CommentPosition.NAKA;
      else if (t === 'ue') position = CommentPosition.UE;
      else if (t === 'shita') position = CommentPosition.SHITA;
      // サイズ
      else if (t === 'big') size = CommentSize.BIG;
      else if (t === 'medium') size = CommentSize.MEDIUM;
      else if (t === 'small') size = CommentSize.SMALL;
      // 命名色 → 常に fill に使用
      else if (StandardColors[t] !== undefined) {
        fillColor = StandardColors[t];
        hasNamedColor = true;
      } else if (isPremium && PremiumColors[t] !== undefined) {
        fillColor = PremiumColors[t];
        hasNamedColor = true;
      }
      // 16進色 (#RRGGBB)
      // 命名色がすでにある場合 → 二色指定の輪郭色 (ニコニコ仕様)
      // 命名色がない場合 → fill 色 (1つめ) または stroke 色 (2つめ以降)
      else if (/^#[0-9a-f]{6}$/i.test(t)) {
        const hex = parseInt(t.slice(1), 16);
        if (hasNamedColor) {
          strokeColor = hex;
        } else if (!hasFillHex) {
          fillColor = hex;
          hasFillHex = true;
        } else {
          strokeColor = hex;
        }
      }
    }
    return { color: fillColor, strokeColor, size, position, rawCommands: raw };
  }

  private static toTokens(v: string | string[] | undefined): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return v.split(/\s+/).filter(Boolean);
  }
}
