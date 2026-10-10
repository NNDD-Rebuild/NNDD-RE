import { useConfig } from '@renderer/hooks/useConfig';
import { CheckRow, CommitInput, Hint, NumberCommitInput, Row, Section } from '../common';

/** 設定 > 全般 > Discord連携 (Rich Presence) */
export function DiscordRpcSection(): JSX.Element {
  const [discordEnabled, setDiscordEnabled] = useConfig<boolean>('discordRpc.enabled', false);
  const [discordShowTitle, setDiscordShowTitle] = useConfig<boolean>('discordRpc.showTitle', true);
  const [discordShowThumbnail, setDiscordShowThumbnail] = useConfig<boolean>('discordRpc.showThumbnail', true);
  const [discordShowGithubButton, setDiscordShowGithubButton] = useConfig<boolean>('discordRpc.showGithubButton', true);

  return (
    <Section title="Discord連携 (Rich Presence)">
      <CheckRow
        checked={discordEnabled}
        onChange={setDiscordEnabled}
        label="再生中の動画をDiscordのステータスに表示する"
      />
      <div className="mt-3">
        <CheckRow checked={discordShowTitle} onChange={setDiscordShowTitle} label="動画タイトルを表示" />
        <CheckRow checked={discordShowThumbnail} onChange={setDiscordShowThumbnail} label="サムネイル画像を表示" />
        <CheckRow
          checked={discordShowGithubButton}
          onChange={setDiscordShowGithubButton}
          label="GitHubリポジトリへのリンクボタンを表示"
        />
      </div>
      <Hint className="mt-2">
        Discordデスクトップアプリが起動している必要があります。
        ボタンは自分のプロフィール画面には表示されず、他のユーザーから見た時のみ表示されます (Discord仕様)。
      </Hint>
    </Section>
  );
}

/** 設定 > 全般 > Webhook通知 (Discord / Slack) */
export function WebhookSection(): JSX.Element {
  const [webhookEnabled, setWebhookEnabled] = useConfig<boolean>('webhookNotify.enabled', false);
  const [webhookUrl, setWebhookUrl] = useConfig<string>('webhookNotify.webhookUrl', '');
  const [webhookNotifyComplete, setWebhookNotifyComplete] = useConfig<boolean>(
    'webhookNotify.notifyOnDownloadComplete',
    true
  );
  const [webhookNotifyFail, setWebhookNotifyFail] = useConfig<boolean>(
    'webhookNotify.notifyOnDownloadFail',
    true
  );

  return (
    <Section title="Webhook通知 (Discord / Slack)">
      <CheckRow
        checked={webhookEnabled}
        onChange={setWebhookEnabled}
        label="ダウンロード状況をWebhookで通知する"
      />
      <Row label="Webhook URL">
        <CommitInput
          placeholder="https://discord.com/api/webhooks/... または https://hooks.slack.com/services/..."
          value={webhookUrl ?? ''}
          onCommit={setWebhookUrl}
          className="flex-1"
        />
      </Row>
      <CheckRow
        checked={webhookNotifyComplete}
        onChange={setWebhookNotifyComplete}
        label="ダウンロード完了時に通知"
      />
      <CheckRow
        checked={webhookNotifyFail}
        onChange={setWebhookNotifyFail}
        label="ダウンロード失敗時に通知"
      />
      <Hint className="mt-2">
        URLのドメインからDiscord / Slackを自動判別して送信します。両方に対応。
      </Hint>
    </Section>
  );
}

/** 設定 > 全般 > チャンネル新着監視 */
export function ChannelWatchSection(): JSX.Element {
  const [channelWatchEnabled, setChannelWatchEnabled] = useConfig<boolean>('channelWatch.enabled', false);
  const [channelWatchIntervalMin, setChannelWatchIntervalMin] = useConfig<number>('channelWatch.intervalMin', 30);

  return (
    <Section title="チャンネル新着監視">
      <CheckRow
        checked={channelWatchEnabled}
        onChange={setChannelWatchEnabled}
        label="登録チャンネルの新着動画を監視して通知する"
      />
      <Row label="チェック間隔">
        <NumberCommitInput
          min={5}
          className="w-20"
          value={channelWatchIntervalMin}
          onCommit={setChannelWatchIntervalMin}
        />
        <Hint>分</Hint>
      </Row>
      <Hint className="mt-2">
        マイリストタブに登録済みのチャンネル (種別: チャンネル) が対象。新着動画をトレイ通知・Webhook通知します
        (DLキューへの自動追加はしません)。設定変更は次回起動時に反映されます。
      </Hint>
    </Section>
  );
}
