import type { DownloadKind } from '@shared/types/download';

/**
 * 動画カードの DL ボタンからダウンロードをキューに積む。
 * kind 省略 (「DL」本体ボタン) は、未DLなら通常DL、DL済みならコメントのみ再取得。
 * 返り値はトースト表示用メッセージ。
 */
export function enqueueDownload(videoId: string, isDownloaded: boolean, kind?: DownloadKind): string {
  const audioOnly = kind === 'audio';
  const commentDiff = kind === 'commentDiff';
  const videoOnly = kind === 'video';
  const commentOnly = kind === 'comment' || commentDiff || (!kind && isDownloaded);
  window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId, commentOnly, commentDiff, audioOnly, videoOnly });
  if (videoOnly) return '動画のみDLリストに追加しました';
  if (audioOnly) return '音声のみDLリストに追加しました';
  if (commentDiff) return 'コメント差分取得をDLリストに追加しました';
  if (commentOnly) return 'コメントのみDLリストに追加しました';
  return 'DLリストに追加しました';
}
