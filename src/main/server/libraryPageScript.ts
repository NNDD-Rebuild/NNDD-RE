/** ライブラリ配信UI (/library) のクライアント JS。libraryPage.ts の <script> に埋め込む */
export const LIBRARY_PAGE_SCRIPT = `(function(){
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

// ue/shita スロット管理 (フォールバック描画専用)
var ueSlots = [];
var shitaSlots = [];

// ---- comment renderer (通常プレイヤーと同じ niconicomments 描画) ----
// WebGL2 非対応ブラウザ (古いスマホ等) では従来の DOM overlay 方式にフォールバックする。
var supportsWebGL2 = (function(){
  try { return !!document.createElement('canvas').getContext('webgl2'); }
  catch(e){ return false; }
})();
var commentLayerEl = document.getElementById('comment-layer');
var videoWrapEl = document.getElementById('video-wrap');
var commentRenderer = null;
var commentStarted = false;
var commentResizeTimer = null;
// フォールバック描画のベースフォントサイズ (動画実表示高さ / 1080 * 36 に連動)
var fallbackBaseFontSize = 14;

if (supportsWebGL2 && window.NNDDLibraryComments) {
  commentRenderer = new window.NNDDLibraryComments.CommentRenderer(commentLayerEl);
  // Firefox は同じ WebGL2 描画でも Chrome 比で著しく重い (縁取り描画・CA専用レイヤー分離のコストが
  // 顕著に出る) ため、体感フレームレートを保つために描画コストの高い設定を軽量側に倒す。
  var isFirefox = /firefox/i.test(navigator.userAgent);
  var initialRenderConfig = Object.assign(
    {}, window.NNDDLibraryComments.DEFAULT_RENDER_CONFIG, { enabled: commentEnabled }
  );
  if (isFirefox) {
    initialRenderConfig.dropShadow = false;
    initialRenderConfig.keepCA = false;
  }
  commentRenderer.setConfig(initialRenderConfig);
  new ResizeObserver(function(){ syncCommentLayer(false); }).observe(commentLayerEl);
} else {
  new ResizeObserver(updateFallbackCommentScale).observe(videoWrapEl);
}

/** CommentRenderer のキャンバスサイズを動画表示サイズに同期させる */
function syncCommentLayer(immediate){
  if (!commentRenderer) return;
  var rect = commentLayerEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  if (!commentStarted) {
    commentStarted = true;
    requestAnimationFrame(function(){
      commentRenderer.onResize(rect.width, rect.height);
      commentRenderer.start(document.getElementById('player'));
    });
    return;
  }
  if (immediate) {
    commentRenderer.onResize(rect.width, rect.height);
    return;
  }
  if (commentResizeTimer !== null) clearTimeout(commentResizeTimer);
  commentResizeTimer = setTimeout(function(){
    commentResizeTimer = null;
    var r = commentLayerEl.getBoundingClientRect();
    commentRenderer.onResize(r.width, r.height);
  }, 100);
}

/** フォールバック DOM overlay 描画のベースフォントサイズを動画表示サイズに連動させる */
function updateFallbackCommentScale(){
  var player = document.getElementById('player');
  var h = (player && player.clientHeight) || videoWrapEl.clientHeight;
  if (h <= 0) return;
  fallbackBaseFontSize = Math.max(10, h / 1080 * 36);
  commentLayerEl.style.fontSize = fallbackBaseFontSize + 'px';
}

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
  // REのプレイヤー (PlayerApp) をそのまま配信する web-player.html へ遷移する
  if(id){
    location.href = '/web-player.html?videoId=' + encodeURIComponent(id);
    return;
  }
  if(v.uri){
    location.href = '/web-player.html?path=' + encodeURIComponent(v.uri);
    return;
  }
  if(!id) return;
  var player = document.getElementById('player');
  var modal = document.getElementById('modal');
  var layer = document.getElementById('comment-layer');
  var title = cleanTitle(v.videoName||'');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-meta').textContent =
    fmtDur(v.duration) + (v.pubDate ? ' \xb7 ' + fmtDate(v.pubDate) : '');
  player.src = '/api/video/' + id + '/stream';
  modal.classList.add('open');

  if (commentRenderer) {
    commentRenderer.setComments([]);
    commentStarted = false;
    syncCommentLayer(true);
  } else {
    layer.innerHTML = '';
    comments = [];
    lastVposMs = -1;
    ueSlots = [];
    shitaSlots = [];
    updateFallbackCommentScale();
    if(commentTimer) clearInterval(commentTimer);
    commentTimer = setInterval(checkComments, 100);
  }

  fetch('/api/video/' + id + '/comments').then(function(r){ return r.json(); }).then(function(data){
    if (commentRenderer) {
      commentRenderer.setComments(data);
    } else {
      comments = data;
    }
  }).catch(function(e){ console.warn('comments fetch failed', e); });
  player.play().catch(function(){ /* 自動再生の制限や読み込み中断で拒否されても、操作で再生できるので無視 */ });
}

function closePlayer(){
  var player = document.getElementById('player');
  player.pause();
  player.src = '';
  if(document.fullscreenElement) document.exitFullscreen().catch(function(){ /* 既に解除済みなら無視 */ });
  document.getElementById('modal').classList.remove('open');
  if (commentRenderer) {
    commentRenderer.stop();
    commentStarted = false;
    commentRenderer.setComments([]);
  } else {
    document.getElementById('comment-layer').innerHTML = '';
    if(commentTimer){ clearInterval(commentTimer); commentTimer = null; }
    comments = [];
    lastVposMs = -1;
  }
}

// ---- comments ----
/** 投稿者コメントのニコスクリプト (@コメント禁止 等) / Flash スクリプト (/～) は画面に流さない */
function isOwnerScript(c){
  if(c.fork !== 'owner' && c.fork !== '1') return false;
  return /^[@＠\/]/.test(c.text || '');
}
function checkComments(){
  var player = document.getElementById('player');
  if(player.paused || !commentEnabled) return;
  var curMs = player.currentTime * 1000;
  var layer = document.getElementById('comment-layer');
  for(var i=0; i<comments.length; i++){
    var c = comments[i];
    if(c.isShow !== false && !isOwnerScript(c) && c.vposMs > lastVposMs && c.vposMs <= curMs){
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

  // sizeCommand: 0=big, 1=medium, 2=small
  div.style.fontSize = c.sizeCommand===0 ? '1.4em' : c.sizeCommand===2 ? '0.75em' : '1em';
  div.style.color = toColor(c.color);
  if(c.strokeColor){
    var sc = toColor(c.strokeColor);
    div.style.textShadow = '1px 1px 0 '+sc+',-1px 1px 0 '+sc+',1px -1px 0 '+sc+',-1px -1px 0 '+sc;
  }

  var LINE = fallbackBaseFontSize * 1.3;
  var pos = c.positionCommand;
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
  if (commentRenderer) {
    commentRenderer.setConfig({ enabled: commentEnabled });
  } else if(!commentEnabled) {
    document.getElementById('comment-layer').innerHTML = '';
  }
};
document.getElementById('btn-fullscreen').onclick = function(){
  var wrap = document.getElementById('video-wrap');
  if(!document.fullscreenElement){
    wrap.requestFullscreen().catch(function(){ /* ブラウザが全画面を拒否した場合はそのまま */ });
  } else {
    document.exitFullscreen().catch(function(){ /* 既に解除済みなら無視 */ });
  }
};
document.addEventListener('fullscreenchange', function(){
  var player = document.getElementById('player');
  var btn = document.getElementById('btn-fullscreen');
  if(!document.fullscreenElement){
    btn.textContent = '全画面';
    if (!commentRenderer) {
      // フォールバック方式: レイアウト変化でコメント位置がずれるのでリセット
      // (CommentRenderer方式は ResizeObserver が自動でサイズ追従する)
      lastVposMs = player.currentTime * 1000 - 1;
      document.getElementById('comment-layer').innerHTML = '';
      ueSlots = []; shitaSlots = [];
    }
  } else {
    btn.textContent = '全画面解除';
  }
});
document.getElementById('player').onseeking = function(){
  if (commentRenderer) {
    commentRenderer.onSeek();
  } else {
    lastVposMs = document.getElementById('player').currentTime * 1000 - 1;
    document.getElementById('comment-layer').innerHTML = '';
    ueSlots = []; shitaSlots = [];
  }
};
document.getElementById('player').onseeked = function(){
  if (commentRenderer) commentRenderer.onSeek();
};

// ---- init ----
loadLibrary();

})();`;
