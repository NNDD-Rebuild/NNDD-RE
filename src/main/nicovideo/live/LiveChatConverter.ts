import type { NNDDREComment } from '@shared/types';
import { CommentCommandParser } from '../comment/CommentCommandParser';
import {
  type Chat,
  Chat_AccountStatus,
  Chat_Modifier_ColorName,
  Chat_Modifier_Font,
  Chat_Modifier_Opacity,
  Chat_Modifier_Pos,
  Chat_Modifier_Size
} from './gen/dwango/nicolive/chat/data/atoms_pb';

/** NDGR の Chat.Modifier → 従来の mail コマンド文字列トークン */
function modifierToCommands(chat: Chat): string[] {
  const cmds: string[] = [];
  const mod = chat.modifier;
  if (mod) {
    if (mod.position === Chat_Modifier_Pos.ue) cmds.push('ue');
    else if (mod.position === Chat_Modifier_Pos.shita) cmds.push('shita');

    if (mod.size === Chat_Modifier_Size.big) cmds.push('big');
    else if (mod.size === Chat_Modifier_Size.small) cmds.push('small');

    if (mod.color.case === 'namedColor') {
      // enum 名 (red, white2 等) はそのままニコニコのコマンド名として通じる
      if (mod.color.value !== Chat_Modifier_ColorName.white) {
        cmds.push(Chat_Modifier_ColorName[mod.color.value]);
      }
    } else if (mod.color.case === 'fullColor') {
      const { r, g, b } = mod.color.value;
      const hex = (n: number): string => n.toString(16).padStart(2, '0');
      cmds.push(`#${hex(r)}${hex(g)}${hex(b)}`);
    }

    if (mod.font === Chat_Modifier_Font.mincho) cmds.push('mincho');
    else if (mod.font === Chat_Modifier_Font.gothic) cmds.push('gothic');

    if (mod.opacity === Chat_Modifier_Opacity.Translucent) cmds.push('_live');
  }
  // 生IDが無くハッシュIDのみ = 184 (匿名) 投稿
  if (chat.rawUserId === undefined && chat.hashedUserId) cmds.push('184');
  return cmds;
}

/**
 * NDGR の Chat を NNDDREComment に変換する。
 * Chat.vpos は番組の vposBaseTime 基準の 1/100 秒。
 */
export function chatToComment(chat: Chat, postedAtMs: number, isShow = true): NNDDREComment {
  const commands = modifierToCommands(chat);
  const isPremium = chat.accountStatus === Chat_AccountStatus.Premium;
  const cmd = CommentCommandParser.parse(commands, isPremium);
  const userId = chat.rawUserId !== undefined ? chat.rawUserId.toString() : (chat.hashedUserId ?? '');
  return {
    thread: 'live',
    no: chat.no,
    vposMs: chat.vpos * 10,
    date: Math.floor(postedAtMs / 1000),
    mail: commands.join(' '),
    userId,
    text: chat.content,
    isPremium,
    isAnonymity: chat.rawUserId === undefined,
    isShow,
    sizeCommand: cmd.size,
    positionCommand: cmd.position,
    color: cmd.color,
    fork: 'main'
  };
}
