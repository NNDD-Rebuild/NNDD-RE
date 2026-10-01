import { LIBRARY_PAGE_STYLE } from './libraryPageStyle';
import { LIBRARY_PAGE_SCRIPT } from './libraryPageScript';

/** ライブラリ配信UI (/library) の HTML を生成する */
export function generateLibraryPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NNDD-RE Library</title>
<style>
${LIBRARY_PAGE_STYLE}
</style>
</head>
<body>
<div class="hdr">
  <h1>NNDD-RE Library</h1>
  <div class="search-wrap">
    <input type="search" id="search" placeholder="タイトル検索...">
  </div>
  <div class="view-btns">
    <button class="view-btn active" id="btn-grid">グリッド</button>
    <button class="view-btn" id="btn-list">リスト</button>
  </div>
</div>

<div class="mob-bar">
  <select id="tag-sel-mob"><option value="">すべて</option></select>
</div>

<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-tabs">
      <button class="sidebar-tab active" id="tab-folder">フォルダ</button>
      <button class="sidebar-tab" id="tab-tag">タグ</button>
    </div>
    <div class="sidebar-list">
      <ul id="folder-list" style="list-style:none"></ul>
      <ul id="tag-list" style="list-style:none;display:none"></ul>
    </div>
  </aside>
  <main class="main">
    <div class="count-lbl" id="count-lbl"></div>
    <div class="video-grid grid-mode" id="video-grid"></div>
    <div class="loading" id="loading">読み込み中...</div>
  </main>
</div>

<div class="modal" id="modal">
  <div class="modal-bd" id="modal-bd"></div>
  <div class="modal-box">
    <div class="modal-hdr">
      <h2 id="modal-title"></h2>
      <button class="modal-close" id="modal-close" title="閉じる">&#x2715;</button>
    </div>
    <div class="video-wrap" id="video-wrap">
      <video id="player" controls preload="metadata"></video>
      <div class="comment-layer" id="comment-layer"></div>
    </div>
    <div class="modal-ctrl">
      <button class="ctrl-btn" id="btn-comment">コメント ON</button>
      <button class="ctrl-btn" id="btn-fullscreen">全画面</button>
      <span class="meta-info" id="modal-meta"></span>
    </div>
  </div>
</div>

<script src="/library-assets/comment-bundle.js"></script>
<script>
${LIBRARY_PAGE_SCRIPT}
</script>
</body>
</html>`;
}
