import { ExternalToolsSettings } from './ExternalToolsSettings';
import { TailscaleSidecarSection } from './TailscaleSidecarSection';
import { HttpServerSection } from './general/HttpServerSection';
import { LanLibrarySection } from './general/LanLibrarySection';
import { DiscordRpcSection, WebhookSection, ChannelWatchSection } from './general/IntegrationSections';
import { SettingsTabs } from './common';

/**
 * 設定 > 外部ツール・連携。
 *  - 外部ツール: yt-dlp / ffmpeg / 外部プレイヤー / NCV
 *  - 通知・連携: Discord Rich Presence / Webhook通知 / チャンネル新着監視
 *  - サーバー・LAN: 内蔵HTTPサーバー / Tailscale / LANライブラリ
 */
export function IntegrationSettings(): JSX.Element {
  return (
    <SettingsTabs
      title="外部ツール・連携"
      tabs={[
        { id: 'tools', label: '外部ツール', content: <ExternalToolsSettings /> },
        {
          id: 'notify',
          label: '通知・連携',
          content: (
            <>
              <DiscordRpcSection />
              <WebhookSection />
              <ChannelWatchSection />
            </>
          )
        },
        {
          id: 'server',
          label: 'サーバー・LAN',
          content: (
            <>
              <HttpServerSection />
              <TailscaleSidecarSection />
              <LanLibrarySection />
            </>
          )
        }
      ]}
    />
  );
}
