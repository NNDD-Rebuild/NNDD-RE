import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Section } from '../common';

/** 設定 > 全般 > Discord連携 (Rich Presence) */
export function DiscordRpcSection(): JSX.Element {
  const [discordEnabled, setDiscordEnabled] = useConfig<boolean>('discordRpc.enabled', false);
  const [discordShowTitle, setDiscordShowTitle] = useConfig<boolean>('discordRpc.showTitle', true);
  const [discordShowThumbnail, setDiscordShowThumbnail] = useConfig<boolean>('discordRpc.showThumbnail', true);
  const [discordShowGithubButton, setDiscordShowGithubButton] = useConfig<boolean>('discordRpc.showGithubButton', true);

  return (
    <Section title="Discord連携 (Rich Presence)">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={discordEnabled}
          onChange={(e) => setDiscordEnabled(e.target.checked)}
        />
        再生中の動画をDiscordのステータスに表示する
      </label>
      <div className="mt-3 space-y-1">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={discordShowTitle}
            onChange={(e) => setDiscordShowTitle(e.target.checked)}
          />
          動画タイトルを表示
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={discordShowThumbnail}
            onChange={(e) => setDiscordShowThumbnail(e.target.checked)}
          />
          サムネイル画像を表示
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={discordShowGithubButton}
            onChange={(e) => setDiscordShowGithubButton(e.target.checked)}
          />
          GitHubリポジトリへのリンクボタンを表示
        </label>
      </div>
      <p className="text-xs text-nndd-subtext mt-2">
        Discordデスクトップアプリが起動している必要があります。
        ボタンは自分のプロフィール画面には表示されず、他のユーザーから見た時のみ表示されます (Discord仕様)。
      </p>
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
  const [webhookUrlInput, setWebhookUrlInput] = useState('');

  useEffect(() => {
    setWebhookUrlInput(webhookUrl ?? '');
  }, [webhookUrl]);

  return (
    <Section title="Webhook通知 (Discord / Slack)">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={webhookEnabled}
          onChange={(e) => setWebhookEnabled(e.target.checked)}
        />
        ダウンロード状況をWebhookで通知する
      </label>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-nndd-subtext w-24 shrink-0">Webhook URL</span>
        <input
          type="text"
          placeholder="https://discord.com/api/webhooks/... または https://hooks.slack.com/services/..."
          value={webhookUrlInput}
          onChange={(e) => setWebhookUrlInput(e.target.value)}
          onBlur={() => setWebhookUrl(webhookUrlInput)}
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
      </div>
      <div className="mt-3 space-y-1">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={webhookNotifyComplete}
            onChange={(e) => setWebhookNotifyComplete(e.target.checked)}
          />
          ダウンロード完了時に通知
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={webhookNotifyFail}
            onChange={(e) => setWebhookNotifyFail(e.target.checked)}
          />
          ダウンロード失敗時に通知
        </label>
      </div>
      <p className="text-xs text-nndd-subtext mt-2">
        URLのドメインからDiscord / Slackを自動判別して送信します。両方に対応。
      </p>
    </Section>
  );
}

/** 設定 > 全般 > チャンネル新着監視 */
export function ChannelWatchSection(): JSX.Element {
  const [channelWatchEnabled, setChannelWatchEnabled] = useConfig<boolean>('channelWatch.enabled', false);
  const [channelWatchIntervalMin, setChannelWatchIntervalMin] = useConfig<number>('channelWatch.intervalMin', 30);

  return (
    <Section title="チャンネル新着監視">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={channelWatchEnabled}
          onChange={(e) => setChannelWatchEnabled(e.target.checked)}
        />
        登録チャンネルの新着動画を監視して通知する
      </label>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-nndd-subtext w-24 shrink-0">チェック間隔</span>
        <input
          type="number"
          min={5}
          value={channelWatchIntervalMin}
          onChange={(e) => setChannelWatchIntervalMin(Number(e.target.value) || 30)}
          className="w-20 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
        <span className="text-xs text-nndd-subtext">分</span>
      </div>
      <p className="text-xs text-nndd-subtext mt-2">
        マイリストタブに登録済みのチャンネル (種別: チャンネル) が対象。新着動画をトレイ通知・Webhook通知します
        (DLキューへの自動追加はしません)。設定変更は次回起動時に反映されます。
      </p>
    </Section>
  );
}
