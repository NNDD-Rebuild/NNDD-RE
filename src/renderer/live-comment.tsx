import React from 'react';
import ReactDOM from 'react-dom/client';
import LiveCommentApp from './LiveCommentApp';
import './platformClass';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('live-comment-root')!).render(
  <React.StrictMode>
    <LiveCommentApp />
  </React.StrictMode>
);
