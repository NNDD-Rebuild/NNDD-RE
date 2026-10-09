import { IpcChannel, type IpcChannelValue } from '@shared/types';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';
import { Section } from './common';

/**
 * 設定 > ランキング・検索・マイリスト。
 * 元: NNDD.mxml の Canvas label="ランキング・検索・マイリスト"
 *
 *  - 起動時タブ
 *  - テーマ
 */
export function NicoSettings(): JSX.Element {
  const [initialTab, setInitialTab] = useConfig<number>('ui.initialTab', 0);
  const [theme, setThemeConfig] = useConfig<'dark' | 'light'>('ui.theme', 'dark');

  const setTheme = (next: 'dark' | 'light'): void => {
    setThemeConfig(next);
    if (next === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  };
  const [contentViewMode, setContentViewModeConfig] = useConfig<'grid' | 'list'>('ui.contentViewMode', 'grid');
  const setContentViewModeStore = useAppStore((s) => s.setContentViewMode);
  const [hideSensitiveContents, setHideSensitiveContents] = useConfig<boolean>(
    'hideSensitiveContents',
    true
  );
  const [searchApi, setSearchApi] = useConfig<'snapshot' | 'nvapi'>('searchApi', 'snapshot');

  const [saveSearchHistory, setSaveSearchHistory] = useConfig<boolean>('saveSearchHistory', true);
  const [saveMyListHistory, setSaveMyListHistory] = useConfig<boolean>('saveMyListHistory', true);
  const showToast = useAppStore((s) => s.showToast);

  const clearHistory = (channel: IpcChannelValue, label: string): void => {
    window.nndd
      .invoke(channel)
      .then(() => showToast(`${label}を消去しました`))
      .catch(() => showToast(`${label}の消去に失敗しました`));
  };

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
        <Row label="センシティブな動画を隠す">
          <input
            type="checkbox"
            checked={hideSensitiveContents}
            onChange={(e) => setHideSensitiveContents(e.target.checked)}
          />
          <span className="text-xs text-nndd-subtext ml-2">
            (OFFでランキングにR18等の閲覧注意動画も表示)
          </span>
        </Row>
        <Row label="検索API">
          <div className="flex gap-4 text-sm">
            {(
              [
                { value: 'snapshot', label: 'スナップショット', desc: '日次更新。新着動画の反映に最大1日程度かかる' },
                { value: 'nvapi', label: 'nvapi (即時反映)', desc: '投稿直後の動画も検索できる。検索結果にタグ情報は出ない' }
              ] as { value: 'snapshot' | 'nvapi'; label: string; desc: string }[]
            ).map(({ value, label, desc }) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="searchApi"
                  value={value}
                  checked={searchApi === value}
                  onChange={() => setSearchApi(value)}
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
        </Row>
      </Section>

      <Section title="入力履歴">
        <Row label="検索履歴を保存する">
          <input
            type="checkbox"
            checked={saveSearchHistory}
            onChange={(e) => setSaveSearchHistory(e.target.checked)}
          />
          <button
            onClick={() => clearHistory(IpcChannel.INPUT_HISTORY_SEARCH_CLEAR, '検索履歴')}
            className="ml-3 text-xs px-2 py-0.5 bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white"
          >
            履歴を消去
          </button>
        </Row>
        <Row label="マイリストの閲覧履歴を保存する">
          <input
            type="checkbox"
            checked={saveMyListHistory}
            onChange={(e) => setSaveMyListHistory(e.target.checked)}
          />
          <button
            onClick={() => clearHistory(IpcChannel.INPUT_HISTORY_MYLIST_CLEAR, 'マイリストの閲覧履歴')}
            className="ml-3 text-xs px-2 py-0.5 bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white"
          >
            履歴を消去
          </button>
        </Row>
        <p className="text-xs text-nndd-subtext">
          検索タブの検索ワード欄とマイリストタブのURL欄に、直近10件が候補として表示されます。
        </p>
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
