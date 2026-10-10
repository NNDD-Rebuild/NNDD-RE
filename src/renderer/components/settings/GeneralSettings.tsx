import { LibraryRootSection } from './general/LibraryRootSection';
import { LoginSection } from './general/LoginSection';
import { PrivacySection, WatchHistorySection } from './general/PrivacySections';
import { HttpServerSection } from './general/HttpServerSection';
import { LanLibrarySection } from './general/LanLibrarySection';
import { TraySection, WindowResetSection } from './general/WindowSections';
import { ImageCacheSection } from './general/ImageCacheSection';
import { DiscordRpcSection, WebhookSection, ChannelWatchSection } from './general/IntegrationSections';
import { DeveloperSection } from './general/DeveloperSection';
import { HonkeImportSettings } from './HonkeImportSettings';
import { PageTitle, SettingsPage } from './common';


/**
 * 設定 > 全般。
 * 元: NNDD.mxml の Canvas label="全般"
 *
 *  - 動画の保存先
 *  - ログイン
 *  - HTTPサーバー起動/停止
 *  - ウィンドウ位置リセット
 *
 * 各設定グループは general/ 配下のコンポーネントが自分の state と初期読み込みを持つ。
 */
interface GeneralSettingsProps {
  onDeveloperModeChange?: (enabled: boolean) => void;
}

export function GeneralSettings({ onDeveloperModeChange }: GeneralSettingsProps): JSX.Element {
  return (
    <SettingsPage>
      <PageTitle title="全般" />

      <LibraryRootSection />
      <LoginSection />
      <PrivacySection />
      <WatchHistorySection />
      <HttpServerSection />
      <LanLibrarySection />
      <TraySection />
      <WindowResetSection />
      <ImageCacheSection />
      <DiscordRpcSection />
      <WebhookSection />
      <ChannelWatchSection />
      <HonkeImportSettings />
      <DeveloperSection onDeveloperModeChange={onDeveloperModeChange} />
    </SettingsPage>
  );
}
