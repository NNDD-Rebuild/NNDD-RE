import { IpcChannel, type IpcChannelValue } from '@shared/types';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';
import { Btn, CheckRow, Hint, PageTitle, RadioGroup, Row, Section, Select, SettingsPage } from './common';

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
    <SettingsPage>
      <PageTitle title="ランキング・検索・マイリスト">
        ランキング・検索・マイリストの主要動作は実装済みです。
        起動時動作・UI・通信に関する詳細設定を以下で調整できます。
      </PageTitle>

      <Section title="ランキング・検索・マイリスト 表示形式">
        <Row label="デフォルト表示">
          <div>
            <RadioGroup
              name="contentViewMode"
              value={contentViewMode}
              onChange={setContentViewMode}
              options={[
                { value: 'grid', label: '⊞ グリッド', hint: 'サムネイル大きく表示' },
                { value: 'list', label: '☰ リスト', hint: 'コンパクトに一覧表示' }
              ]}
            />
            <Hint className="mt-1">ライブラリの表示形式は「DLリスト・ライブラリ」タブで設定できます。</Hint>
          </div>
        </Row>
        <Row label="センシティブな動画を隠す" hint="OFFでランキングにR18等の閲覧注意動画も表示">
          <CheckRow checked={hideSensitiveContents} onChange={setHideSensitiveContents} label="隠す" />
        </Row>
        <Row label="検索API">
          <RadioGroup
            name="searchApi"
            value={searchApi}
            onChange={setSearchApi}
            options={[
              { value: 'snapshot', label: 'スナップショット', hint: '日次更新。新着動画の反映に最大1日程度かかる' },
              { value: 'nvapi', label: 'nvapi (即時反映)', hint: '投稿直後の動画も検索できる。検索結果にタグ情報は出ない' }
            ]}
          />
        </Row>
      </Section>

      <Section title="入力履歴">
        <Row label="検索履歴を保存する">
          <CheckRow checked={saveSearchHistory} onChange={setSaveSearchHistory} label="保存する" />
          <Btn onClick={() => clearHistory(IpcChannel.INPUT_HISTORY_SEARCH_CLEAR, '検索履歴')}>履歴を消去</Btn>
        </Row>
        <Row label="マイリストの閲覧履歴を保存する">
          <CheckRow checked={saveMyListHistory} onChange={setSaveMyListHistory} label="保存する" />
          <Btn onClick={() => clearHistory(IpcChannel.INPUT_HISTORY_MYLIST_CLEAR, 'マイリストの閲覧履歴')}>
            履歴を消去
          </Btn>
        </Row>
        <Hint>検索タブの検索ワード欄とマイリストタブのURL欄に、直近10件が候補として表示されます。</Hint>
      </Section>

      <Section title="アプリ起動・UI">
        <Row label="起動時のタブ">
          <Select value={initialTab} onChange={(e) => setInitialTab(Number(e.target.value))}>
            <option value={0}>ランキング</option>
            <option value={1}>検索</option>
            <option value={2}>マイリスト</option>
            <option value={3}>DLリスト</option>
            <option value={4}>ライブラリ</option>
            <option value={5}>履歴</option>
            <option value={6}>設定</option>
          </Select>
        </Row>
        <Row label="テーマ">
          <Select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
            <option value="dark">ダーク</option>
            <option value="light">ライト</option>
          </Select>
        </Row>
      </Section>
    </SettingsPage>
  );
}
