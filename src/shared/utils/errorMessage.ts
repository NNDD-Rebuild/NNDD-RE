/** エラーメッセージ内に含まれる HTTPステータスコードを抽出 */
function extractHttpStatus(message: string): number | null {
  const match = message.match(/HTTP\s+(\d{3})\b/) ?? message.match(/status[=:]\s*(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

/** WatchInfoHandler.classifyApiError が付与するprefix → ユーザー向け日本語文言 */
const VIDEO_ERROR_MESSAGES: Record<string, string> = {
  VIDEO_DELETED: '動画が削除されているか、存在しません。',
  VIDEO_RESTRICTED: '非公開・限定公開・ログインが必要な動画のいずれかの可能性があります。',
  VIDEO_MAINTENANCE: 'ニコニコ動画がメンテナンス中の可能性があります。時間を置いて再度お試しください。',
  VIDEO_UNKNOWN_ERROR: '動画情報の取得に失敗しました。'
};

/**
 * main プロセスから伝播した Error をユーザー向けの日本語メッセージに変換する。
 * VIDEO_DELETED等 (WatchInfoHandler.classifyApiError) は専用文言に、
 * 401/403 (未ログイン・権限なし) はログイン促しメッセージに、それ以外は元メッセージを返す。
 */
export function toUserFriendlyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [prefix, friendly] of Object.entries(VIDEO_ERROR_MESSAGES)) {
    if (message.startsWith(`${prefix}:`)) return friendly;
  }
  const status = extractHttpStatus(message);
  if (status === 401 || status === 403) {
    return 'ログインしていません。ログインしてから再度お試しください。';
  }
  return message;
}
