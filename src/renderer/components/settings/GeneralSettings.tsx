import { LibraryRootSection } from './general/LibraryRootSection';
import { LoginSection } from './general/LoginSection';
import { PrivacySection, WatchHistorySection } from './general/PrivacySections';
import { HttpServerSection } from './general/HttpServerSection';
import { LanLibrarySection } from './general/LanLibrarySection';
import { TraySection, WindowResetSection } from './general/WindowSections';
import { ImageCacheSection } from './general/ImageCacheSection';
import { DiscordRpcSection, WebhookSection, ChannelWatchSection } from './general/IntegrationSections';
import { DeveloperSection } from './general/DeveloperSection';


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
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">全般</h2>

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
      <DeveloperSection onDeveloperModeChange={onDeveloperModeChange} />
    </div>
  );
}
