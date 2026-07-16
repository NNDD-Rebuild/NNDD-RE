import React from 'react';
import ReactDOM from 'react-dom/client';
import CommentApp from './CommentApp';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('comment-root')!).render(
  <React.StrictMode>
    <CommentApp />
  </React.StrictMode>
);
