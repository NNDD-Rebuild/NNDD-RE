import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * 設定 > ランキング・検索・マイリスト。
 * 元: NNDD.mxml の Canvas label="ランキング・検索・マイリスト"
 *
 *  - トレイ (有効/最小化→トレイ)
 *  - 起動時タブ
 *  - テーマ
 */
export function NicoSettings(): JSX.Element {
  const [trayEnabled, setTrayEnabled] = useConfig<boolean>(
    'tray.enabled',
    true
  );
  const [minimizeToTray, setMinimizeToTray] = useConfig<boolean>(
    'tray.minimizeToTray',
    true
  );
  const [initialTab, setInitialTab] = useConfig<number>('ui.initialTab', 0);
  const [theme, setThemeConfig] = useConfig<'dark' | 'light'>('ui.theme', 'dark');

  const setTheme = (next: 'dark' | 'light'): void => {
    setThemeConfig(next);
    if (next === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  };
  const [contentViewMode, setContentViewModeConfig] = useConfig<'grid' | 'list'>('ui.contentViewMode', 'grid');
  const setContentViewModeStore = useAppStore((s) => s.setContentViewMode);

  const setContentViewMode = (mode: 'grid' | 'list'): void => {
    setContentViewModeConfig(mode);
    setContentViewModeStore(mode);
  };

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">
        ランキング・検索・マイリスト
      </h2>
      <p className="text-xs text-nndd-subtext mb-4">
        ランキング・検索・マイリストの主要動作は実装済みです。
        起動時動作・UI・通信に関する詳細設定を以下で調整できます。
      </p>

      <Section title="ランキング・検索・マイリスト 表示形式">
        <Row label="デフォルト表示">
          <div className="flex gap-4 text-sm">
            {(
              [
                { value: 'grid', label: '⊞ グリッド', desc: 'サムネイル大きく表示' },
                { value: 'list', label: '☰ リスト', desc: 'コンパクトに一覧表示' }
              ] as { value: 'grid' | 'list'; label: string; desc: string }[]
            ).map(({ value, label, desc }) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="contentViewMode"
                  value={value}
                  checked={contentViewMode === value}
                  onChange={() => setContentViewMode(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <br />
                  <span className="text-xs text-nndd-subtext">{desc}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-nndd-subtext mt-1">
            ライブラリの表示形式は「DLリスト・ライブラリ」タブで設定できます。
          </p>
        </Row>
      </Section>

      <Section title="アプリ起動・UI">
        <Row label="起動時のタブ">
          <select
            value={initialTab}
            onChange={(e) => setInitialTab(Number(e.target.value))}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value={0}>ランキング</option>
            <option value={1}>検索</option>
            <option value={2}>マイリスト</option>
            <option value={3}>DLリスト</option>
            <option value={4}>ライブラリ</option>
            <option value={5}>履歴</option>
            <option value={6}>設定</option>
          </select>
        </Row>
        <Row label="テーマ">
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value="dark">ダーク</option>
            <option value="light">ライト</option>
          </select>
        </Row>
      </Section>

      <Section title="システムトレイ">
        <Row label="トレイアイコンを表示">
          <input
            type="checkbox"
            checked={trayEnabled}
            onChange={(e) => setTrayEnabled(e.target.checked)}
          />
        </Row>
        <Row label="ウィンドウを閉じたらトレイに最小化">
          <input
            type="checkbox"
            checked={minimizeToTray}
            onChange={(e) => setMinimizeToTray(e.target.checked)}
          />
          <span className="text-xs text-nndd-subtext ml-2">
            (DLが続行できます)
          </span>
        </Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5">
      <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">
        {title}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center mb-2">
      <div className="w-56 text-xs text-nndd-subtext shrink-0">{label}</div>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  );
}
