import { useConfig } from '@renderer/hooks/useConfig';
import { Section } from '../common';

/** 設定 > 全般 > プライバシー (視聴履歴を残さない) */
export function PrivacySection(): JSX.Element {
  const [hideWatchHistory, setHideWatchHistory] = useConfig<boolean>('hideWatchHistory', false);
  const [sensitiveVideoHistoryPolicy, setSensitiveVideoHistoryPolicy] = useConfig<'ask' | 'allow' | 'deny'>(
    'sensitiveVideoHistoryPolicy',
    'ask'
  );

  return (
    <Section title="プライバシー">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={hideWatchHistory}
          onChange={(e) => setHideWatchHistory(e.target.checked)}
        />
        視聴履歴を残さない
      </label>
      <p className="text-xs text-nndd-subtext mt-2">
        ONにすると、動画再生・ダウンロード時にニコニコ動画へCookieを送らずゲスト扱いでアクセスし、
        アカウントの視聴履歴に残しません。年齢制限動画・チャンネル会員限定動画は
        視聴・ダウンロードできなくなる場合があります。
      </p>
      {hideWatchHistory && (
        <div className="mt-3 pl-1 space-y-1">
          <div className="text-xs text-nndd-subtext mb-1">
            視聴履歴非表示中に再生できない動画（年齢制限等）への対応
          </div>
          {(
            [
              { value: 'ask', label: '毎回確認する' },
              { value: 'allow', label: '常に履歴を残して再生する' },
              { value: 'deny', label: '常に再生しない' }
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer select-none text-sm"
            >
              <input
                type="radio"
                name="sensitiveVideoHistoryPolicy"
                checked={sensitiveVideoHistoryPolicy === opt.value}
                onChange={() => setSensitiveVideoHistoryPolicy(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </Section>
  );
}

/** 設定 > 全般 > 視聴履歴 (再生済みバッジ) */
export function WatchHistorySection(): JSX.Element {
  const [showWatchedBadge, setShowWatchedBadge] = useConfig<boolean>('history.showWatchedBadge', true);

  return (
    <Section title="視聴履歴">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={showWatchedBadge}
          onChange={(e) => setShowWatchedBadge(e.target.checked)}
        />
        ランキング・フォロー中・マイリストに再生済みバッジを表示する
      </label>
      <p className="text-xs text-nndd-subtext mt-2">
        このアプリ内での視聴記録、およびニコニコ動画本家の視聴履歴 (起動時に自動取得) の
        いずれかに含まれる動画にバッジを表示します。
      </p>
    </Section>
  );
}
