import { useEffect, useState } from 'react';
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
type SubTab =
  | 'general'
  | 'nico'
  | 'library'
  | 'schedule'
  | 'player'
  | 'tools'
  | 'connection'
  | 'log'
  | 'update'
  | 'debug';

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'general', label: '全般' },
  { id: 'nico', label: 'ランキング・検索・マイリスト' },
  { id: 'library', label: 'DLリスト・ライブラリ' },
  { id: 'schedule', label: 'スケジュール' },
  { id: 'player', label: 'プレイヤー' },
  { id: 'tools', label: '外部ツール' },
  { id: 'connection', label: '接続診断' },
  { id: 'log', label: 'ログ' },
  { id: 'update', label: 'バージョン情報・更新' }
];

export function SettingsView(): JSX.Element {
  const [active, setActive] = useState<SubTab>('general');
  const [version, setVersion] = useState('');
  const [developerEnabled, setDeveloperEnabled] = useState(false);

  useEffect(() => {
    window.nndd
      .invoke<string>(window.nndd.channels.SYS_GET_VERSION)
      .then(setVersion);
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'developer.enabled')
      .then((v) => setDeveloperEnabled(v !== false))
      .catch(() => {});
  }, []);

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
        {version && (
          <div className="border-t border-nndd-border px-4 py-2 text-xs text-nndd-subtext">
            NNDD-RE v{version}
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto">
        {active === 'general' && <GeneralSettings onDeveloperModeChange={setDeveloperEnabled} />}
        {active === 'nico' && <NicoSettings />}
        {active === 'library' && <LibrarySettings />}
        {active === 'schedule' && <ScheduleSettings />}
        {active === 'player' && <PlayerSettings />}
        {active === 'tools' && <ExternalToolsSettings />}
        {active === 'connection' && <ConnectionDiagnostics />}
        {active === 'log' && <LogViewer />}
        {active === 'update' && <UpdateSettings />}
        {active === 'debug' && <DebugSettings />}
      </main>
    </div>
  );
}
