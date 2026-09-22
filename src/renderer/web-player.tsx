// ブラウザ版プレイヤー。Electron の preload が無いので、PlayerApp を読み込む前に
// window.nndd / window.electron を HTTP 越しの shim で用意する。
// 副作用 import: 他のモジュールより先に評価されるよう最初に置くこと。
import './webShim';
import React from 'react';
import ReactDOM from 'react-dom/client';
import PlayerApp from './PlayerApp';
import { WebBackButton } from './WebBackButton';
import { WebAutoPlay } from './WebAutoPlay';
import './platformClass';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('player-root')!).render(
  <React.StrictMode>
    <PlayerApp />
    <WebBackButton />
    <WebAutoPlay />
  </React.StrictMode>
);
