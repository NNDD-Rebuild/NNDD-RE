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

/**
 * 生放送のタイムシフトをダウンロードキューに積む。確認ダイアログで了承された場合のみ追加する。
 * 未予約・未視聴だと予約と視聴開始が必要で、視聴開始で視聴期限のカウントが始まり取り消せないため、
 * 了承された場合だけ activateTimeshift を付けて自動で行う。
 * 返り値はトースト表示用メッセージ。取りやめた場合は null
 */
export function enqueueLiveDownload(programId: string, title: string, thumbnailUrl?: string): string | null {
  const ok = window.confirm(
    `「${title}」のタイムシフトをダウンロードします。\n\n` +
      '未予約・未視聴の場合は、予約と視聴開始を自動で行います。視聴開始すると視聴期限のカウントが始まります (取り消せません)。\n' +
      'よろしいですか？'
  );
  if (!ok) return null;
  window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, {
    videoId: programId,
    activateTimeshift: true,
    thumbnailUrl: thumbnailUrl || undefined
  });
  return 'DLリストに追加しました';
}

/**
 * 放送中の生放送を録画としてキューに積む。番組の終了か、DLリストの「録画停止」まで続く。
 * プレミアム会員で最初から録画できる番組は、開始前に確認ダイアログで選ばせる。
 * 返り値はトースト表示用メッセージ。取りやめた場合は null
 * @param thumbnailUrl 一覧で見えているサムネイル (番組情報から取れない放送中の番組の代わりに使う)
 */
export async function enqueueLiveRecord(programId: string, thumbnailUrl?: string): Promise<string | null> {
  const choice = await window.nndd.invoke<'fromStart' | 'now' | 'cancel'>(window.nndd.channels.LIVE_RECORD_ASK, programId);
  if (choice === 'cancel') return null;
  await window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, {
    videoId: programId,
    record: true,
    fromStart: choice === 'fromStart',
    thumbnailUrl: thumbnailUrl || undefined
  });
  return choice === 'fromStart'
    ? '放送開始からの録画を開始しました (DLリストで停止できます)'
    : '録画を開始しました (DLリストで停止できます)';
}
