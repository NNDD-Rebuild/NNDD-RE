import React from 'react';
import ReactDOM from 'react-dom/client';
import PlayerApp from './PlayerApp';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('player-root')!).render(
  <React.StrictMode>
    <PlayerApp />
  </React.StrictMode>
);
