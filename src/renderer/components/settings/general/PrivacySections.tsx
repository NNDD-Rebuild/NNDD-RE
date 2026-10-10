import { useConfig } from '@renderer/hooks/useConfig';
import { CheckRow, Hint, RadioGroup, Section } from '../common';

/** 設定 > 全般 > プライバシー (視聴履歴を残さない) */
export function PrivacySection(): JSX.Element {
  const [hideWatchHistory, setHideWatchHistory] = useConfig<boolean>('hideWatchHistory', false);
  const [sensitiveVideoHistoryPolicy, setSensitiveVideoHistoryPolicy] = useConfig<'ask' | 'allow' | 'deny'>(
    'sensitiveVideoHistoryPolicy',
    'ask'
  );

  return (
    <Section title="プライバシー">
      <CheckRow
        checked={hideWatchHistory}
        onChange={setHideWatchHistory}
        label="視聴履歴を残さない"
        hint="ONにすると、動画再生・ダウンロード時にニコニコ動画へCookieを送らずゲスト扱いでアクセスし、アカウントの視聴履歴に残しません。年齢制限動画・チャンネル会員限定動画は視聴・ダウンロードできなくなる場合があります。"
      />
      {hideWatchHistory && (
        <div className="mt-3 pl-1">
          <Hint className="mb-1">視聴履歴非表示中に再生できない動画（年齢制限等）への対応</Hint>
          <RadioGroup
            name="sensitiveVideoHistoryPolicy"
            direction="column"
            value={sensitiveVideoHistoryPolicy}
            onChange={setSensitiveVideoHistoryPolicy}
            options={[
              { value: 'ask', label: '毎回確認する' },
              { value: 'allow', label: '常に履歴を残して再生する' },
              { value: 'deny', label: '常に再生しない' }
            ]}
          />
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
      <CheckRow
        checked={showWatchedBadge}
        onChange={setShowWatchedBadge}
        label="ランキング・フォロー中・マイリストに再生済みバッジを表示する"
        hint="このアプリ内での視聴記録、およびニコニコ動画本家の視聴履歴 (起動時に自動取得) のいずれかに含まれる動画にバッジを表示します。"
      />
    </Section>
  );
}
