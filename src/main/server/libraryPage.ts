/** ライブラリ配信UI (/library) の HTML を生成する */
export function generateLibraryPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NNDD-RE Library</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#111827;--surface:#1f2937;--surface2:#374151;
  --border:#374151;--text:#f3f4f6;--sub:#9ca3af;
  --accent:#3b82f6;--accent2:#1d4ed8;--green:#22c55e;
  --radius:6px;
}
body{background:var(--bg);color:var(--text);font-family:"MS PGothic","Yu Gothic UI","Meiryo",sans-serif;font-size:14px;min-height:100vh}
a{color:var(--accent);text-decoration:none}
/* Header */
.hdr{
  display:flex;align-items:center;gap:10px;
  padding:10px 16px;background:var(--surface);
  border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;
}
.hdr h1{font-size:16px;font-weight:bold;white-space:nowrap;color:var(--text)}
.search-wrap{flex:1;min-width:0}
.search-wrap input{
  width:100%;padding:6px 10px;
  background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--radius);color:var(--text);font-size:13px;
}
.search-wrap input:focus{outline:none;border-color:var(--accent)}
.view-btns{display:flex;gap:4px;flex-shrink:0}
.view-btn{
  padding:5px 10px;background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--radius);color:var(--sub);cursor:pointer;font-size:12px;
}
.view-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
/* Mobile bar */
.mob-bar{
  display:none;padding:8px 12px;background:var(--surface);
  border-bottom:1px solid var(--border);
}
.mob-bar select{
  width:100%;padding:6px 8px;background:var(--surface2);
  border:1px solid var(--border);border-radius:var(--radius);
  color:var(--text);font-size:13px;
}
/* Layout */
.layout{display:flex;min-height:calc(100vh - 49px)}
/* Sidebar */
.sidebar{
  width:180px;flex-shrink:0;
  background:var(--surface);border-right:1px solid var(--border);
  display:flex;flex-direction:column;
  max-height:calc(100vh - 49px);position:sticky;top:49px;
}
/* Sidebar tabs */
.sidebar-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.sidebar-tab{
  flex:1;padding:6px 4px;font-size:11px;text-align:center;
  cursor:pointer;color:var(--sub);border:none;background:none;
  border-bottom:2px solid transparent;transition:all .1s;
}
.sidebar-tab.active{color:var(--text);border-bottom-color:var(--accent)}
.sidebar-tab:hover{color:var(--text)}
.sidebar-list{flex:1;overflow-y:auto;padding:6px 0}
.sidebar-hd{padding:6px 12px 4px;font-size:11px;color:var(--sub);font-weight:bold;letter-spacing:.05em}
.tag-item,.folder-item{
  display:block;padding:5px 12px;cursor:pointer;font-size:13px;
  color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:background .1s;
}
.tag-item:hover,.folder-item:hover{background:var(--surface2);color:var(--text)}
.tag-item.active,.folder-item.active{background:var(--accent2);color:#fff}
/* Main */
.main{flex:1;padding:12px;min-width:0}
.count-lbl{font-size:12px;color:var(--sub);margin-bottom:10px}
/* Grid */
.video-grid.grid-mode{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
  gap:12px;
}
.video-grid.list-mode{display:flex;flex-direction:column;gap:6px}
/* Card - grid */
.grid-mode .card{
  background:var(--surface);border-radius:var(--radius);
  overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s;
  border:1px solid var(--border);
}
.grid-mode .card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.4)}
.card-thumb{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden}
.card-thumb img{width:100%;height:100%;object-fit:cover}
.no-thumb{
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  color:var(--sub);font-size:11px;background:var(--surface2);
}
.card-dur{
  position:absolute;bottom:4px;right:4px;
  background:rgba(0,0,0,.75);color:#fff;font-size:11px;
  padding:1px 4px;border-radius:3px;
}
.card-info{padding:8px}
.card-title{font-size:12px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.card-meta{font-size:11px;color:var(--sub);margin-top:3px}
/* Card - list */
.list-mode .card{
  display:flex;align-items:center;gap:10px;
  background:var(--surface);border-radius:var(--radius);
  padding:8px;cursor:pointer;border:1px solid var(--border);
  transition:background .1s;
}
.list-mode .card:hover{background:var(--surface2)}
.list-thumb{width:120px;flex-shrink:0;aspect-ratio:16/9;background:#000;border-radius:4px;overflow:hidden}
.list-thumb img{width:100%;height:100%;object-fit:cover}
.list-info{flex:1;min-width:0}
.list-info .card-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.list-info .card-meta{font-size:11px;color:var(--sub);margin-top:3px}
.list-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.tag-chip{
  font-size:10px;padding:1px 6px;background:var(--surface2);
  border-radius:10px;color:var(--sub);border:1px solid var(--border);
}
/* Loading */
.loading{padding:24px;text-align:center;color:var(--sub)}
/* Modal */
.modal{
  display:none;position:fixed;inset:0;z-index:100;
  align-items:center;justify-content:center;
}
.modal.open{display:flex}
.modal-bd{position:absolute;inset:0;background:rgba(0,0,0,.7)}
.modal-box{
  position:relative;z-index:1;
  width:min(92vw,900px);max-height:92vh;
  background:var(--surface);border-radius:8px;
  border:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;
}
.modal-hdr{
  display:flex;align-items:center;gap:8px;
  padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;
}
.modal-hdr h2{flex:1;font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.modal-close{
  background:none;border:none;color:var(--sub);cursor:pointer;
  font-size:20px;line-height:1;padding:2px 6px;
}
.modal-close:hover{color:var(--text)}
.video-wrap{position:relative;background:#000;flex-shrink:0}
video{width:100%;display:block;max-height:70vh}
.comment-layer{
  position:absolute;inset:0;pointer-events:none;overflow:hidden;
}
.comment-item{
  position:absolute;
  color:#fff;
  font-weight:bold;
  white-space:nowrap;
  line-height:1.3;
  text-shadow:1px 1px 2px #000,-1px -1px 2px #000;
  pointer-events:none;
}
@keyframes slideLeft{
  from{left:100%}
  to{left:-110%}
}
/* Fullscreen */
.video-wrap:-webkit-full-screen{width:100vw;height:100vh}
.video-wrap:-moz-full-screen{width:100vw;height:100vh}
.video-wrap:fullscreen{width:100vw;height:100vh}
.video-wrap:-webkit-full-screen video{max-height:100vh;height:100%}
.video-wrap:-moz-full-screen video{max-height:100vh;height:100%}
.video-wrap:fullscreen video{max-height:100vh;height:100%}
.video-wrap:-webkit-full-screen .comment-layer{position:absolute;inset:0}
.video-wrap:-moz-full-screen .comment-layer{position:absolute;inset:0}
.video-wrap:fullscreen .comment-layer{position:absolute;inset:0}
.modal-ctrl{
  padding:8px 14px;border-top:1px solid var(--border);
  display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.ctrl-btn{
  padding:4px 12px;background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--radius);color:var(--text);cursor:pointer;font-size:12px;
}
.ctrl-btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}
.ctrl-btn.off{background:var(--surface2);color:var(--sub)}
.meta-info{font-size:11px;color:var(--sub)}
/* Responsive */
@media(max-width:768px){
  .hdr{padding:8px 10px}
  .hdr h1{font-size:14px}
  .sidebar{display:none}
  .mob-bar{display:block}
  .video-grid.grid-mode{grid-template-columns:repeat(2,1fr);gap:8px}
  .list-thumb{width:80px}
  .modal-box{width:100vw;max-height:100vh;border-radius:0;border:none}
  video{max-height:50vh}
}
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

<script>
(function(){
'use strict';

// ---- state ----
var videos = [];
var selectedTag = '';
var selectedFolder = '';
var sidebarMode = 'folder';
var searchText = '';
var viewMode = 'grid';
var commentEnabled = true;
var comments = [];
var lastVposMs = -1;
var commentTimer = null;

// ue/shita スロット管理
var ueSlots = [];
var shitaSlots = [];

// ---- color ----
var COLOR_MAP = {
  0xFFFFFF:'#ffffff', 0xFF0000:'#ff0000', 0x00FF00:'#00ff00',
  0x0000FF:'#3399ff', 0xFFFF00:'#ffff00', 0x00FFFF:'#00ffff',
  0xFF00FF:'#ff00ff', 0x000000:'#333333', 0xFF8080:'#ff8080',
  0x66CC66:'#66cc66', 0x0088CC:'#0088cc', 0xFF6600:'#ff6600',
  0xCC0033:'#cc0033', 0x00CC66:'#00cc66', 0x552222:'#552222',
  0x008888:'#008888',
};
function toColor(n){
  return COLOR_MAP[n] || ('#' + (n >>> 0).toString(16).padStart(6,'0'));
}

// ---- utils ----
function esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cleanTitle(name){
  var t = name.replace(/\\.[^\\.]+$/, '');
  t = t.replace(/\\s*-?\\s*\\[(?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\\d+\\]/,'').trim();
  return t || name;
}
function fmtDur(sec){
  if(!sec) return '--:--';
  var m = Math.floor(sec/60), s = Math.floor(sec%60);
  return m + ':' + String(s).padStart(2,'0');
}
function fmtDate(d){
  if(!d) return '';
  var dt = new Date(d);
  if(isNaN(dt)) return '';
  return dt.getFullYear() + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0');
}

// ---- load ----
function loadLibrary(){
  document.getElementById('loading').style.display = '';
  fetch('/api/library').then(function(r){ return r.json(); }).then(function(data){
    videos = data;
    buildSidebar();
    render();
    document.getElementById('loading').style.display = 'none';
  }).catch(function(e){
    document.getElementById('loading').textContent = '読み込みエラー: ' + e.message;
  });
}

// ---- sidebar ----
function buildSidebar(){
  buildFolderList();
  buildTagList();
  buildMobSelect();
}

function buildFolderList(){
  var folderCount = {};
  videos.forEach(function(v){
    var f = v.folder || '(不明)';
    folderCount[f] = (folderCount[f]||0)+1;
  });
  var sorted = Object.keys(folderCount).sort();
  var list = document.getElementById('folder-list');
  list.innerHTML = '';
  var li0 = document.createElement('li');
  li0.className = 'folder-item' + (selectedFolder===''?' active':'');
  li0.dataset.folder = '';
  li0.textContent = 'すべて (' + videos.length + ')';
  li0.onclick = function(){ selectFolder(''); };
  list.appendChild(li0);
  sorted.forEach(function(folder){
    var li = document.createElement('li');
    li.className = 'folder-item' + (selectedFolder===folder?' active':'');
    li.dataset.folder = folder;
    li.textContent = folder + ' (' + folderCount[folder] + ')';
    li.onclick = function(){ selectFolder(folder); };
    list.appendChild(li);
  });
}

function buildTagList(){
  var tagCount = {};
  videos.forEach(function(v){
    (v.tags||[]).forEach(function(t){ tagCount[t] = (tagCount[t]||0)+1; });
  });
  var sorted = Object.keys(tagCount).sort(function(a,b){ return tagCount[b]-tagCount[a]; });
  var list = document.getElementById('tag-list');
  list.innerHTML = '';
  var li0 = document.createElement('li');
  li0.className = 'tag-item' + (selectedTag===''?' active':'');
  li0.dataset.tag = '';
  li0.textContent = 'すべて (' + videos.length + ')';
  li0.onclick = function(){ selectTag(''); };
  list.appendChild(li0);
  sorted.forEach(function(tag){
    var li = document.createElement('li');
    li.className = 'tag-item' + (selectedTag===tag?' active':'');
    li.dataset.tag = tag;
    li.textContent = tag + ' (' + tagCount[tag] + ')';
    li.onclick = function(){ selectTag(tag); };
    list.appendChild(li);
  });
}

function buildMobSelect(){
  var sel = document.getElementById('tag-sel-mob');
  var tagCount = {};
  videos.forEach(function(v){
    (v.tags||[]).forEach(function(t){ tagCount[t] = (tagCount[t]||0)+1; });
  });
  var sorted = Object.keys(tagCount).sort(function(a,b){ return tagCount[b]-tagCount[a]; });
  sel.innerHTML = '<option value="">すべて (' + videos.length + ')</option>';
  sorted.forEach(function(tag){
    var opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag + ' (' + tagCount[tag] + ')';
    if(selectedTag===tag) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setSidebarMode(mode){
  sidebarMode = mode;
  document.getElementById('folder-list').style.display = mode==='folder' ? '' : 'none';
  document.getElementById('tag-list').style.display = mode==='tag' ? '' : 'none';
  document.getElementById('tab-folder').classList.toggle('active', mode==='folder');
  document.getElementById('tab-tag').classList.toggle('active', mode==='tag');
}

function selectFolder(folder){
  selectedFolder = folder;
  document.querySelectorAll('.folder-item').forEach(function(el){
    el.classList.toggle('active', el.dataset.folder === folder);
  });
  render();
}

function selectTag(tag){
  selectedTag = tag;
  document.querySelectorAll('.tag-item').forEach(function(el){
    el.classList.toggle('active', el.dataset.tag === tag);
  });
  document.getElementById('tag-sel-mob').value = tag;
  render();
}

// ---- render ----
function getFiltered(){
  return videos.filter(function(v){
    if(sidebarMode==='folder' && selectedFolder && (v.folder||'(不明)')!==selectedFolder) return false;
    if(sidebarMode==='tag' && selectedTag && !(v.tags||[]).includes(selectedTag)) return false;
    if(searchText.trim()){
      var q = searchText.toLowerCase();
      if(!(v.videoName||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function render(){
  var list = getFiltered();
  document.getElementById('count-lbl').textContent = list.length + ' 件';
  var grid = document.getElementById('video-grid');
  grid.innerHTML = '';
  list.forEach(function(v){ grid.appendChild(createCard(v)); });
}

function createCard(v){
  var id = v.videoId;
  var title = cleanTitle(v.videoName||'(不明)');
  var card = document.createElement('div');
  card.className = 'card';
  card.onclick = function(){ openPlayer(v); };

  if(viewMode === 'grid'){
    var thumbHtml = id
      ? '<img src="/api/video/'+esc(id)+'/thumb" alt="" loading="lazy" class="card-img">'
      : '<div class="no-thumb">No Image</div>';
    card.innerHTML =
      '<div class="card-thumb">'+thumbHtml+
      '<div class="card-dur">'+esc(fmtDur(v.duration))+'</div></div>'+
      '<div class="card-info">'+
        '<div class="card-title" title="'+esc(v.videoName||'')+'">'+esc(title)+'</div>'+
        '<div class="card-meta">'+esc(v.videoId||'')+(v.playCount?' \xb7 '+v.playCount+'回再生':'')+'</div>'+
      '</div>';
  } else {
    var thumbHtml2 = id
      ? '<img src="/api/video/'+esc(id)+'/thumb" alt="" loading="lazy" class="card-img">'
      : '';
    var tagsHtml = (v.tags||[]).map(function(t){ return '<span class="tag-chip">'+esc(t)+'</span>'; }).join('');
    card.innerHTML =
      '<div class="list-thumb">'+thumbHtml2+'</div>'+
      '<div class="list-info">'+
        '<div class="card-title" title="'+esc(v.videoName||'')+'">'+esc(title)+'</div>'+
        '<div class="card-meta">'+esc(fmtDur(v.duration))+(v.videoId?' \xb7 '+esc(v.videoId):'')+(v.playCount?' \xb7 '+v.playCount+'回再生':'')+(v.pubDate?' \xb7 '+esc(fmtDate(v.pubDate)):'')+'</div>'+
        '<div class="list-tags">'+tagsHtml+'</div>'+
      '</div>';
  }
  return card;
}

// ---- player ----
function openPlayer(v){
  var id = v.videoId;
  if(!id) return;
  var player = document.getElementById('player');
  var modal = document.getElementById('modal');
  var layer = document.getElementById('comment-layer');
  var title = cleanTitle(v.videoName||'');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-meta').textContent =
    fmtDur(v.duration) + (v.pubDate ? ' \xb7 ' + fmtDate(v.pubDate) : '');
  player.src = '/api/video/' + id + '/stream';
  layer.innerHTML = '';
  modal.classList.add('open');
  comments = [];
  lastVposMs = -1;
  ueSlots = [];
  shitaSlots = [];
  fetch('/api/video/' + id + '/comments').then(function(r){ return r.json(); }).then(function(data){
    comments = data;
  }).catch(function(){});
  if(commentTimer) clearInterval(commentTimer);
  commentTimer = setInterval(checkComments, 100);
  player.play().catch(function(){});
}

function closePlayer(){
  var player = document.getElementById('player');
  player.pause();
  player.src = '';
  if(document.fullscreenElement) document.exitFullscreen().catch(function(){});
  document.getElementById('modal').classList.remove('open');
  document.getElementById('comment-layer').innerHTML = '';
  if(commentTimer){ clearInterval(commentTimer); commentTimer = null; }
  comments = [];
  lastVposMs = -1;
}

// ---- comments ----
function checkComments(){
  var player = document.getElementById('player');
  if(player.paused || !commentEnabled) return;
  var curMs = player.currentTime * 1000;
  var layer = document.getElementById('comment-layer');
  for(var i=0; i<comments.length; i++){
    var c = comments[i];
    if(c.vposMs > lastVposMs && c.vposMs <= curMs){
      showComment(layer, c);
    }
  }
  lastVposMs = curMs;
}

function getSlot(slots, maxLines, expire){
  for(var i=0; i<maxLines; i++){
    if(!slots[i] || Date.now() > slots[i]){
      slots[i] = Date.now() + expire;
      return i;
    }
  }
  return (Date.now() % maxLines)|0;
}

function showComment(layer, c){
  var div = document.createElement('div');
  div.className = 'comment-item';
  div.textContent = c.text;

  // size: 0=big, 1=medium, 2=small
  div.style.fontSize = c.size===0 ? '1.4em' : c.size===2 ? '0.75em' : '1em';
  div.style.color = toColor(c.color);
  if(c.strokeColor){
    var sc = toColor(c.strokeColor);
    div.style.textShadow = '1px 1px 0 '+sc+',-1px 1px 0 '+sc+',1px -1px 0 '+sc+',-1px -1px 0 '+sc;
  }

  var LINE = 28;
  var pos = c.pos;
  if(pos === 'ue'){
    var slot = getSlot(ueSlots, 8, 4000);
    div.style.top = (slot * LINE) + 'px';
    div.style.left = '0'; div.style.right = '0';
    div.style.textAlign = 'center';
    setTimeout(function(){ div.remove(); }, 4000);
  } else if(pos === 'shita'){
    var slot2 = getSlot(shitaSlots, 8, 4000);
    div.style.bottom = (slot2 * LINE) + 'px';
    div.style.left = '0'; div.style.right = '0';
    div.style.textAlign = 'center';
    setTimeout(function(){ div.remove(); }, 4000);
  } else {
    var topPct = 10 + Math.random() * 75;
    div.style.top = topPct + '%';
    div.style.whiteSpace = 'nowrap';
    div.style.animation = 'slideLeft 4s linear forwards';
    div.addEventListener('animationend', function(){ div.remove(); });
  }
  layer.appendChild(div);
}

// ---- img error fallback ----
document.addEventListener('error', function(e){
  var t = e.target;
  if(!t || t.tagName !== 'IMG' || !t.classList.contains('card-img')) return;
  var wrap = t.parentNode;
  if(!wrap) return;
  var d = document.createElement('div');
  d.className = 'no-thumb';
  d.textContent = 'No Image';
  wrap.replaceChild(d, t);
}, true);

// ---- event bindings ----
document.getElementById('tab-folder').onclick = function(){ setSidebarMode('folder'); };
document.getElementById('tab-tag').onclick = function(){ setSidebarMode('tag'); };

document.getElementById('btn-grid').onclick = function(){
  viewMode = 'grid';
  document.getElementById('video-grid').className = 'video-grid grid-mode';
  document.getElementById('btn-grid').classList.add('active');
  document.getElementById('btn-list').classList.remove('active');
  render();
};
document.getElementById('btn-list').onclick = function(){
  viewMode = 'list';
  document.getElementById('video-grid').className = 'video-grid list-mode';
  document.getElementById('btn-list').classList.add('active');
  document.getElementById('btn-grid').classList.remove('active');
  render();
};
document.getElementById('search').oninput = function(e){
  searchText = e.target.value;
  render();
};
document.getElementById('tag-sel-mob').onchange = function(e){
  selectTag(e.target.value);
};
document.getElementById('modal-close').onclick = closePlayer;
document.getElementById('modal-bd').onclick = closePlayer;
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && !document.fullscreenElement) closePlayer();
});
document.getElementById('btn-comment').onclick = function(){
  commentEnabled = !commentEnabled;
  var btn = document.getElementById('btn-comment');
  btn.textContent = commentEnabled ? 'コメント ON' : 'コメント OFF';
  btn.classList.toggle('off', !commentEnabled);
  if(!commentEnabled) document.getElementById('comment-layer').innerHTML = '';
};
document.getElementById('btn-fullscreen').onclick = function(){
  var wrap = document.getElementById('video-wrap');
  if(!document.fullscreenElement){
    wrap.requestFullscreen().catch(function(){});
  } else {
    document.exitFullscreen().catch(function(){});
  }
};
document.addEventListener('fullscreenchange', function(){
  var wrap = document.getElementById('video-wrap');
  var player = document.getElementById('player');
  var btn = document.getElementById('btn-fullscreen');
  if(!document.fullscreenElement){
    // 全画面解除 - レイアウト変化でコメント位置がずれるのでリセット
    btn.textContent = '全画面';
    lastVposMs = player.currentTime * 1000 - 1;
    document.getElementById('comment-layer').innerHTML = '';
    ueSlots = []; shitaSlots = [];
  } else {
    btn.textContent = '全画面解除';
  }
});
document.getElementById('player').onseeking = function(){
  lastVposMs = document.getElementById('player').currentTime * 1000 - 1;
  document.getElementById('comment-layer').innerHTML = '';
  ueSlots = []; shitaSlots = [];
};

// ---- init ----
loadLibrary();

})();
</script>
</body>
</html>`;
}
