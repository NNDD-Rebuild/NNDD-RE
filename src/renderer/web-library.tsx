// ブラウザ版ライブラリ。REの LibraryView をそのまま表示する。
// 副作用 import: 他のモジュールより先に評価されるよう最初に置くこと。
import './webShim';
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { LibraryView } from './components/library/LibraryView';
import { useAppStore } from './store/useAppStore';
import './platformClass';
import './styles/global.css';

function WebLibraryApp(): JSX.Element {
  const setLibraryViewMode = useAppStore((s) => s.setLibraryViewMode);

  // App.tsx と同様に、表示モード・テーマを設定から反映する
  useEffect(() => {
    window.nndd
      .invoke<'table' | 'grid'>(window.nndd.channels.CONFIG_GET, 'ui.libraryViewMode')
      .then((v) => { if (v === 'table' || v === 'grid') setLibraryViewMode(v); })
      .catch(() => {});
    window.nndd
      .invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-screen bg-nndd-bg text-nndd-text">
      <div className="flex-1 min-h-0 overflow-hidden">
        <LibraryView />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('library-root')!).render(
  <React.StrictMode>
    <WebLibraryApp />
  </React.StrictMode>
);
