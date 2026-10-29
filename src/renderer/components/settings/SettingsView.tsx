import { useEffect, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';
import { GeneralSettings } from './GeneralSettings';
import { PlayerSettings } from './PlayerSettings';
import { LiveSettings } from './LiveSettings';
import { DownloadSettings, LibrarySettings } from './LibrarySettings';
import { NicoSettings } from './NicoSettings';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { ScheduleSettings } from './ScheduleSettings';
import { LogViewer } from './LogViewer';
import { UpdateSettings } from './UpdateSettings';
import { IntegrationSettings } from './IntegrationSettings';
import { DebugSettings } from './DebugSettings';
import { NgCommentSettings } from './NgCommentSettings';
import { BackupSettings } from './BackupSettings';
import { SettingsTabs } from './common';
import { trackRenderer } from '@renderer/util/telemetry';

/**
 * 設定タブ。
 * 左のメニューで項目を切り替える。項目内でさらに分かれるもの:
 *  - ダウンロード: ダウンロード / スケジュール
 *  - 外部ツール・連携: 外部ツール / 通知・連携 / サーバー・LAN (IntegrationSettings)
 */
export type SubTab =
  | 'general'
  | 'nico'
  | 'download'
  | 'library'
  | 'player'
  | 'live'
  | 'ng'
  | 'tools'
  | 'backup'
  | 'update'
  | 'connection'
  | 'log'
  | 'debug';

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'general', label: '全般' },
  { id: 'nico', label: '表示・検索' },
  { id: 'download', label: 'ダウンロード' },
  { id: 'library', label: 'ライブラリ' },
  { id: 'player', label: 'プレイヤー' },
  { id: 'live', label: '生放送' },
  { id: 'ng', label: 'NGコメント' },
  { id: 'tools', label: '外部ツール・連携' },
  { id: 'backup', label: 'バックアップ・移行' },
  { id: 'update', label: '情報・更新' },
  { id: 'connection', label: '接続診断' },
  { id: 'log', label: 'ログ' }
];

export function SettingsView(): JSX.Element {
  const [active, setActive] = useState<SubTab>('general');
  const [developerEnabled, setDeveloperEnabled] = useState(false);
  const pendingSettingsTab = useAppStore((s) => s.pendingSettingsTab);
  const setPendingSettingsTab = useAppStore((s) => s.setPendingSettingsTab);

  useEffect(() => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'developer.enabled')
      .then((v) => setDeveloperEnabled(v !== false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (pendingSettingsTab) {
      setActive(pendingSettingsTab);
      setPendingSettingsTab(null);
    }
  }, [pendingSettingsTab, setPendingSettingsTab]);

  return (
    <div className="h-full flex">
      <aside className="w-max min-w-[9rem] shrink-0 border-r border-nndd-border bg-nndd-panel flex flex-col">
        <div className="flex-1 overflow-auto">
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                trackRenderer({ name: 'settings_subtab', props: { sub: t.id, changed: t.id !== active } });
                setActive(t.id);
              }}
              className={[
                'block w-full text-left px-5 py-2 text-sm border-b border-nndd-border whitespace-nowrap',
                active === t.id
                  ? 'bg-nndd-bg text-nndd-text border-l-2 border-l-nndd-accent'
                  : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text'
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
          {developerEnabled && (
            <button
              onClick={() => {
                trackRenderer({ name: 'settings_subtab', props: { sub: 'debug', changed: active !== 'debug' } });
                setActive('debug');
              }}
              className={[
                'block w-full text-left px-5 py-2 text-sm border-b border-nndd-border whitespace-nowrap',
                active === 'debug'
                  ? 'bg-nndd-bg text-nndd-text border-l-2 border-l-nndd-accent'
                  : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text bg-nndd-border/50'
              ].join(' ')}
            >
              🔧 デバッグ
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {active === 'general' && <GeneralSettings onDeveloperModeChange={setDeveloperEnabled} />}
        {active === 'nico' && <NicoSettings />}
        {active === 'download' && (
          <SettingsTabs
            title="ダウンロード"
            tabs={[
              { id: 'download', label: 'ダウンロード', content: <DownloadSettings /> },
              { id: 'schedule', label: 'スケジュール', content: <ScheduleSettings /> }
            ]}
          />
        )}
        {active === 'library' && <LibrarySettings />}
        {active === 'player' && <PlayerSettings />}
        {active === 'live' && <LiveSettings />}
        {active === 'ng' && <NgCommentSettings />}
        {active === 'tools' && <IntegrationSettings />}
        {active === 'connection' && <ConnectionDiagnostics />}
        {active === 'log' && <LogViewer />}
        {active === 'update' && <UpdateSettings />}
        {active === 'backup' && <BackupSettings />}
        {active === 'debug' && <DebugSettings />}
      </main>
    </div>
  );
}
