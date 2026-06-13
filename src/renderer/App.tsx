import { useEffect, useState } from 'react';
import { MAIN_TABS, useAppStore, type MainTab } from './store/useAppStore';
import { IpcChannel } from '@shared/types';
import { RankingView } from './components/ranking/RankingView';
import { SearchView } from './components/search/SearchView';
import { FollowView } from './components/follow/FollowView';
import { MyListView } from './components/mylist/MyListView';
import { DownloadView } from './components/download/DownloadView';
import { LibraryView } from './components/library/LibraryView';
import { HistoryView } from './components/history/HistoryView';
import { SettingsView } from './components/settings/SettingsView';
import { LoginArea } from './components/common/LoginArea';
import { StatusBar } from './components/common/StatusBar';

export default function App(): JSX.Element {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const toastMessage = useAppStore((s) => s.toastMessage);
  const setPendingMylistId = useAppStore((s) => s.setPendingMylistId);
  const setPendingSeriesId = useAppStore((s) => s.setPendingSeriesId);
  const setPendingSearchTag = useAppStore((s) => s.setPendingSearchTag);
  const setContentViewMode = useAppStore((s) => s.setContentViewMode);
  const setLibraryViewMode = useAppStore((s) => s.setLibraryViewMode);

  // 起動時に設定値をZustandストアに読み込む (設定変更の即時反映用)
  useEffect(() => {
    window.nndd.invoke<'grid' | 'list'>(window.nndd.channels.CONFIG_GET, 'ui.contentViewMode')
      .then((v) => { if (v === 'grid' || v === 'list') setContentViewMode(v); })
      .catch(() => {});
    window.nndd.invoke<'table' | 'grid'>(window.nndd.channels.CONFIG_GET, 'ui.libraryViewMode')
      .then((v) => { if (v === 'table' || v === 'grid') setLibraryViewMode(v); })
      .catch(() => {});
    window.nndd.invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 一度アクティブになったタブはアンマウントせず display:none で保持
  const [mountedTabs, setMountedTabs] = useState<Set<MainTab>>(new Set([activeTab]));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  // トレイメニューからのタブ切替
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      'nndd:tray:openTab',
      (_e, tab: MainTab) => setActiveTab(tab)
    );
    return off;
  }, [setActiveTab]);

  // プレイヤーからのマイリストナビゲーション
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      IpcChannel.NAV_MYLIST,
      (_e, mylistId: string) => {
        setActiveTab('mylist');
        setPendingMylistId(mylistId);
      }
    );
    return off;
  }, [setActiveTab, setPendingMylistId]);

  // プレイヤーからのシリーズナビゲーション
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      IpcChannel.NAV_SERIES,
      (_e, seriesId: string) => {
        setActiveTab('mylist');
        setPendingSeriesId(seriesId);
      }
    );
    return off;
  }, [setActiveTab, setPendingSeriesId]);

  // プレイヤーからのタグ検索ナビゲーション
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      IpcChannel.NAV_SEARCH_TAG,
      (_e, tag: string) => {
        setActiveTab('search');
        setPendingSearchTag(tag);
      }
    );
    return off;
  }, [setActiveTab, setPendingSearchTag]);

  function tabContent(id: MainTab): JSX.Element {
    switch (id) {
      case 'ranking': return <RankingView />;
      case 'search': return <SearchView />;
      case 'follow': return <FollowView />;
      case 'mylist': return <MyListView />;
      case 'download': return <DownloadView />;
      case 'library': return <LibraryView />;
      case 'history': return <HistoryView />;
      case 'settings': return <SettingsView />;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-nndd-bg text-nndd-text">
      <div className="flex items-center border-b border-nndd-border bg-nndd-panel">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-4 py-2 text-sm border-r border-nndd-border transition-colors',
              activeTab === tab.id
                ? 'bg-nndd-bg text-nndd-text border-b-2 border-b-nndd-accent -mb-px'
                : 'text-nndd-subtext hover:bg-nndd-border hover:text-nndd-text'
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
        <LoginArea />
      </div>
      <div className="flex-1 overflow-hidden relative">
        {MAIN_TABS.map((tab) => (
          <div
            key={tab.id}
            className={[
              'absolute inset-0',
              activeTab === tab.id ? 'block' : 'hidden'
            ].join(' ')}
          >
            {tab.id === 'library'
              ? activeTab === tab.id && tabContent(tab.id)
              : mountedTabs.has(tab.id) && tabContent(tab.id)}
          </div>
        ))}
      </div>
      <StatusBar />
      {toastMessage && (
        <div className="fixed bottom-10 right-4 z-50 px-4 py-2 bg-nndd-accent text-white text-sm rounded shadow-lg pointer-events-none">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
