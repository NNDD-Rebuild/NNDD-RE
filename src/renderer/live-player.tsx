import React from 'react';
import ReactDOM from 'react-dom/client';
import LivePlayerApp from './LivePlayerApp';
import './platformClass';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('live-root')!).render(
  <React.StrictMode>
    <LivePlayerApp />
  </React.StrictMode>
);
