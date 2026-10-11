import type { WatchAccessRestriction } from '../types/watch';

/** 視聴権限が足りないときにユーザーへ見せる案内文 */
export function describeAccessRestriction(
  restriction: WatchAccessRestriction,
  channelName?: string | null
): string {
  switch (restriction) {
    case 'premium_only':
      return 'プレミアム会員限定の動画です。プレミアム会員のアカウントでログインすると視聴できます。';
    case 'channel_member':
      return channelName
        ? `チャンネル会員限定の動画です。「${channelName}」への入会が必要です (プレミアム会員でも別途入会が必要です)。`
        : 'チャンネル会員限定の動画です。チャンネルへの入会が必要です (プレミアム会員でも別途入会が必要です)。';
    case 'payment_required':
      return '購入または入会が必要な動画です。ニコニコ動画のサイトで視聴条件を確認してください。';
  }
}
