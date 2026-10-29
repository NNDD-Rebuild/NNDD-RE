import { LibraryRootSection } from './general/LibraryRootSection';
import { LoginSection } from './general/LoginSection';
import { PrivacySection } from './general/PrivacySections';
import { TraySection, WindowResetSection } from './general/WindowSections';
import { DeveloperSection } from './general/DeveloperSection';
import { PageTitle, SettingsPage } from './common';


/**
 * 設定 > 全般。
 * 元: NNDD.mxml の Canvas label="全般"
 *
 *  - 動画の保存先
 *  - ログイン
 *  - プライバシー
 *  - システムトレイ・ウィンドウ位置リセット
 *  - 開発者オプション
 *
 * HTTPサーバー・LANライブラリは「外部ツール・連携 > サーバー・LAN」、Discord・Webhook・
 * チャンネル監視は「外部ツール・連携 > 通知・連携」、画像キャッシュは「ライブラリ」、
 * 本家NNDDインポートは「バックアップ・移行」に移動した。
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
      <TraySection />
      <WindowResetSection />
      <DeveloperSection onDeveloperModeChange={onDeveloperModeChange} />
    </SettingsPage>
  );
}
