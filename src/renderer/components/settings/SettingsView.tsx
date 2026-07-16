import { useEffect, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';
import { GeneralSettings } from './GeneralSettings';
import { PlayerSettings } from './PlayerSettings';
import { LibrarySettings } from './LibrarySettings';
import { NicoSettings } from './NicoSettings';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { ScheduleSettings } from './ScheduleSettings';
import { LogViewer } from './LogViewer';
import { UpdateSettings } from './UpdateSettings';
import { ExternalToolsSettings } from './ExternalToolsSettings';
import { DebugSettings } from './DebugSettings';
import { NgCommentSettings } from './NgCommentSettings';
import { BackupSettings } from './BackupSettings';

/**
 * 設定タブ。
 * 元: NNDD.mxml の Canvas label="設定" 内のサブタブ
 *  - 全般
 *  - ランキング・検索・マイリスト
 *  - DLリスト・ライブラリ
 *  - スケジュール
 *  - プレイヤー
 *  - 接続診断
 *  - ログ
 *  - 更新
 */
export type SubTab =
  | 'general'
  | 'nico'
  | 'library'
  | 'schedule'
  | 'player'
  | 'ng'
  | 'tools'
  | 'connection'
  | 'log'
  | 'update'
  | 'backup'
  | 'debug';

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'general', label: '全般' },
  { id: 'nico', label: 'ランキング・検索・マイリスト' },
  { id: 'library', label: 'DLリスト・ライブラリ' },
  { id: 'schedule', label: 'スケジュール' },
  { id: 'player', label: 'プレイヤー' },
  { id: 'ng', label: 'NGコメント' },
  { id: 'tools', label: '外部ツール' },
  { id: 'connection', label: '接続診断' },
  { id: 'log', label: 'ログ' },
  { id: 'update', label: '情報' },
  { id: 'backup', label: 'バックアップ' }
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
      <aside className="w-56 border-r border-nndd-border bg-nndd-panel flex flex-col">
        <div className="flex-1 overflow-auto">
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={[
                'block w-full text-left px-4 py-2 text-sm border-b border-nndd-border',
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
              onClick={() => setActive('debug')}
              className={[
                'block w-full text-left px-4 py-2 text-sm border-b border-nndd-border',
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
        {active === 'library' && <LibrarySettings />}
        {active === 'schedule' && <ScheduleSettings />}
        {active === 'player' && <PlayerSettings />}
        {active === 'ng' && <NgCommentSettings />}
        {active === 'tools' && <ExternalToolsSettings />}
        {active === 'connection' && <ConnectionDiagnostics />}
        {active === 'log' && <LogViewer />}
        {active === 'update' && <UpdateSettings />}
        {active === 'backup' && <BackupSettings />}
        {active === 'debug' && <DebugSettings />}
      </main>
    </div>
  );
}
