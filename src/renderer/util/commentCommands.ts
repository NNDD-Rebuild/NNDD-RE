import {
  CommentPosition,
  type CommentPositionValue,
  CommentSize,
  type CommentSizeValue,
  StandardColors,
  PremiumColors,
  type NNDDREComment
} from '@shared/types';

/**
 * レンダラー側でも mail/commands をパースできるようにするヘルパー。
 * (メインプロセスの CommentCommandParser とロジック同じ)
 */
export interface ParsedCommand {
  color: number;
  strokeColor?: number;
  size: CommentSizeValue;
  position: CommentPositionValue;
}

export function parseCommentCommand(
  mailOrCommands: string | string[] | undefined,
  isPremium: boolean
): ParsedCommand {
  const tokens = Array.isArray(mailOrCommands)
    ? mailOrCommands
    : (mailOrCommands ?? '').split(/\s+/).filter(Boolean);

  let fillColor = 0xffffff;
  let strokeColor: number | undefined;
  let hasNamedColor = false;
  let hasFillHex = false;
  let size: CommentSizeValue = CommentSize.MEDIUM;
  let position: CommentPositionValue = CommentPosition.NAKA;

  for (const tRaw of tokens) {
    const t = tRaw.toLowerCase();
    if (t === 'naka') position = CommentPosition.NAKA;
    else if (t === 'ue') position = CommentPosition.UE;
    else if (t === 'shita') position = CommentPosition.SHITA;
    else if (t === 'big') size = CommentSize.BIG;
    else if (t === 'medium') size = CommentSize.MEDIUM;
    else if (t === 'small') size = CommentSize.SMALL;
    else if (StandardColors[t] !== undefined) {
      fillColor = StandardColors[t];
      hasNamedColor = true;
    } else if (isPremium && PremiumColors[t] !== undefined) {
      fillColor = PremiumColors[t];
      hasNamedColor = true;
    } else if (/^#[0-9a-f]{6}$/i.test(t)) {
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
  return { color: fillColor, strokeColor, size, position };
}

/**
 * NNDDREComment にコマンド情報を埋め込む (mail からパースする場合用)
 */
export function ensureCommandResolved(c: NNDDREComment): NNDDREComment {
  if (c.color === 0 && (!c.mail || c.mail.length === 0)) {
    return c;
  }
  // すでに正規化されていればそのまま
  if (c.color > 0 && c.sizeCommand !== undefined && c.positionCommand) {
    return c;
  }
  const parsed = parseCommentCommand(c.mail, c.isPremium);
  return {
    ...c,
    color: c.color || parsed.color,
    sizeCommand: c.sizeCommand ?? parsed.size,
    positionCommand: c.positionCommand ?? parsed.position
  };
}
