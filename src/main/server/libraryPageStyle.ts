import { UI_FONT_FAMILY } from '@shared/constants';

/** ライブラリ配信UI (/library) の CSS。libraryPage.ts の <style> に埋め込む */
export const LIBRARY_PAGE_STYLE = `*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#111827;--surface:#1f2937;--surface2:#374151;
  --border:#374151;--text:#f3f4f6;--sub:#9ca3af;
  --accent:#3b82f6;--accent2:#1d4ed8;--green:#22c55e;
  --radius:6px;
}
body{background:var(--bg);color:var(--text);font-family:${UI_FONT_FAMILY};font-size:14px;min-height:100vh}
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
.comment-layer canvas{
  position:absolute;inset:0;
  width:100%;height:100%;
  display:block;
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
}`;
