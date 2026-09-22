// ブラウザ版 NNDD-RE。ライブラリ (LibraryView) とプレイヤー (PlayerApp) を1ページにまとめる。
//
// ページ遷移せず画面を切り替えるのは、ブラウザの自動再生制限のため。
// ページを読み直すとクリックの許可 (user activation) が失われ Firefox 等で音なし再生になるが、
// 同一ドキュメント内の切替なら許可が引き継がれ、音ありで自動再生できる。
//
// webShim は副作用 import (window.nndd を用意する) なので、他のモジュールより先に評価されるよう最初に置くこと。
import { OPEN_PLAYER_EVENT, openPlayerFromLocation } from './webShim';
import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import PlayerApp from './PlayerApp';
import { LibraryView } from './components/library/LibraryView';
import { useAppStore } from './store/useAppStore';
import { WebBackButton } from './WebBackButton';
import { WebAutoPlay } from './WebAutoPlay';
import { WebGearMenu } from './WebGearMenu';
import './platformClass';
import './styles/global.css';
import './web.css';

type Route = 'library' | 'player';

const PLAYER_PATH = '/web-player.html';
const routeFromLocation = (): Route =>
  location.pathname.endsWith(PLAYER_PATH) ? 'player' : 'library';

function WebApp(): JSX.Element {
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const setLibraryViewMode = useAppStore((s) => s.setLibraryViewMode);

  // App.tsx と同様に、表示モード・テーマを設定から反映する
  useEffect(() => {
    window.nndd
      .invoke<'table' | 'grid'>(window.nndd.channels.CONFIG_GET, 'ui.libraryViewMode')
      .then((v) => {
        // 狭い画面ではカード表示を既定にする (このブラウザで選択済みなら尊重)
        const narrow = window.matchMedia('(max-width: 768px)').matches;
        let picked = false;
        try { picked = localStorage.getItem('nndd-web:cfg:ui.libraryViewMode') !== null; } catch { /* 無視 */ }
        if (narrow && !picked) setLibraryViewMode('grid');
        else if (v === 'table' || v === 'grid') setLibraryViewMode(v);
      })
      .catch(() => {});
    window.nndd
      .invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // ライブラリ等からの再生要求: URL を積んでプレイヤー表示へ (init は shim が保持済み)
    const onOpen = (e: Event): void => {
      const query = (e as CustomEvent<Record<string, string>>).detail ?? {};
      history.pushState(
        { inApp: true },
        '',
        `${PLAYER_PATH}?${new URLSearchParams(query).toString()}`
      );
      setRoute('player');
    };
    // ブラウザの戻る/進む
    const onPop = (): void => {
      const next = routeFromLocation();
      if (next === 'player') openPlayerFromLocation();
      setRoute(next);
    };
    window.addEventListener(OPEN_PLAYER_EVENT, onOpen);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener(OPEN_PLAYER_EVENT, onOpen);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const goLibrary = useCallback((): void => {
    if ((history.state as { inApp?: boolean } | null)?.inApp) {
      history.back();
    } else {
      history.pushState(null, '', '/library');
      setRoute('library');
    }
  }, []);

  return (
    <>
      {/* ライブラリは非表示でも保持する (フォルダ選択・スクロール位置を戻ったときに維持) */}
      <div
        className="flex flex-col bg-nndd-bg text-nndd-text"
        // モバイルではアドレスバーの分だけ 100vh がはみ出すため dvh を使う
        style={route === 'library' ? { height: '100dvh' } : { display: 'none' }}
      >
        <div className={`web-library ${sidebarOpen ? 'sidebar-open' : ''}`}>
          {/* 狭い画面のみ表示: フォルダ/タグのドロワーを開くボタン (CSS で制御) */}
          <div className="web-lib-bar">
            <button type="button" onClick={() => setSidebarOpen(true)}>
              ☰ フォルダ・タグ
            </button>
          </div>
          <div
            className="web-lib-body"
            onClick={(e) => {
              // ドロワー内のフォルダ/タグを選んだら閉じる (タブ切替ボタンでは閉じない)
              const t = e.target as HTMLElement;
              if (sidebarOpen && t.closest('aside .overflow-auto')) setSidebarOpen(false);
            }}
          >
            <LibraryView />
            <div className="web-lib-backdrop" onClick={() => setSidebarOpen(false)} />
          </div>
        </div>
      </div>
      {route === 'player' && (
        <>
          <div className="web-player">
            <PlayerApp />
          </div>
          <WebBackButton onBack={goLibrary} />
          <WebAutoPlay />
          <WebGearMenu />
        </>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('web-root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>
);
