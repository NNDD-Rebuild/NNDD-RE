import { create } from 'zustand';
import type { SubTab } from '../components/settings/SettingsView';

/**
 * メインウィンドウの主要状態。
 * 元: NNDD.mxml の TabNavigator のアクティブタブ管理など。
 */
export type MainTab =
  | 'ranking'
  | 'search'
  | 'follow'
  | 'mylist'
  | 'download'
  | 'library'
  | 'history'
  | 'settings';

export const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'ranking', label: 'ランキング' },
  { id: 'search', label: '検索' },
  { id: 'follow', label: 'フォロー中' },
  { id: 'mylist', label: 'マイリスト' },
  { id: 'download', label: 'DLリスト' },
  { id: 'library', label: 'ライブラリ' },
  { id: 'history', label: '履歴' },
  { id: 'settings', label: '設定' }
];

interface AppState {
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;

  isLoggedIn: boolean;
  setLoggedIn: (v: boolean) => void;

  statusMessage: string;
  setStatusMessage: (s: string) => void;

  /** プレイヤーからマイリストタブを開く際のID。MyListViewが処理後 null にクリア */
  pendingMylistId: string | null;
  setPendingMylistId: (id: string | null) => void;

  /** 検索からシリーズを開く際のID。MyListViewが処理後 null にクリア */
  pendingSeriesId: string | null;
  setPendingSeriesId: (id: string | null) => void;

  /** プレイヤーからタグ検索を開く際のタグ文字列。SearchViewが処理後 null にクリア */
  pendingSearchTag: string | null;
  setPendingSearchTag: (tag: string | null) => void;

  /** プレイヤーから投稿者の動画一覧を開く際のユーザー情報。FollowViewが処理後 null にクリア */
  pendingFollowUser: { id: string; nickname: string; iconUrl: string } | null;
  setPendingFollowUser: (user: { id: string; nickname: string; iconUrl: string } | null) => void;

  /** 他画面から設定の特定サブタブを開く際に使用。SettingsViewが処理後 null にクリア */
  pendingSettingsTab: SubTab | null;
  setPendingSettingsTab: (tab: SubTab | null) => void;

  /**
   * ランキング・検索・マイリスト・フォロー共通の表示モード。
   * 設定変更で即時反映するためにZustandで管理。
   */
  contentViewMode: 'grid' | 'list';
  setContentViewMode: (mode: 'grid' | 'list') => void;

  /**
   * ライブラリの表示モード。
   * 設定変更で即時反映するためにZustandで管理。
   */
  libraryViewMode: 'table' | 'grid';
  setLibraryViewMode: (mode: 'table' | 'grid') => void;

  toastMessage: string | null;
  showToast: (msg: string, durationMs?: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'ranking',
  setActiveTab: (tab) => set({ activeTab: tab }),
  isLoggedIn: false,
  setLoggedIn: (v) => set({ isLoggedIn: v }),
  statusMessage: '',
  setStatusMessage: (s) => set({ statusMessage: s }),
  pendingMylistId: null,
  setPendingMylistId: (id) => set({ pendingMylistId: id }),
  pendingSeriesId: null,
  setPendingSeriesId: (id) => set({ pendingSeriesId: id }),
  pendingSearchTag: null,
  setPendingSearchTag: (tag) => set({ pendingSearchTag: tag }),
  pendingFollowUser: null,
  setPendingFollowUser: (user) => set({ pendingFollowUser: user }),
  pendingSettingsTab: null,
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  contentViewMode: 'grid',
  setContentViewMode: (mode) => set({ contentViewMode: mode }),
  libraryViewMode: 'table',
  setLibraryViewMode: (mode) => set({ libraryViewMode: mode }),
  toastMessage: null,
  showToast: (msg, durationMs = 2500) => {
    set({ toastMessage: msg });
    setTimeout(() => set({ toastMessage: null }), durationMs);
  },
}));
