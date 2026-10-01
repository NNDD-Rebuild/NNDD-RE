import type { LanVideo } from './libraryUtils';

/** 右ペイン (LANライブラリ選択時): 絞り込み・接続状態・更新ボタン + 動画テーブル */
export function LanLibraryPane({
  lanSearchText,
  onLanSearchTextChange,
  lanReachable,
  lanLoading,
  lanVideos,
  playingLanId,
  onReload,
  onPlay
}: {
  lanSearchText: string;
  onLanSearchTextChange: (v: string) => void;
  lanReachable: boolean | null;
  lanLoading: boolean;
  lanVideos: LanVideo[];
  playingLanId: string | null;
  onReload: () => Promise<void>;
  onPlay: (videoId: string) => Promise<void>;
}): JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
        <input
          value={lanSearchText}
          onChange={(e) => onLanSearchTextChange(e.target.value)}
          placeholder="タイトルで絞り込み"
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
        {lanReachable === true && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400">接続中</span>
        )}
        {lanReachable === false && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-600/20 text-red-400">接続失敗</span>
        )}
        <button
          onClick={() => void onReload()}
          disabled={lanLoading}
          className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
        >
          {lanLoading ? '読込中…' : '更新'}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {lanLoading ? (
          <div className="p-4 text-nndd-subtext">読み込み中…</div>
        ) : lanReachable === false ? (
          <div className="p-4 text-nndd-subtext">接続できませんでした</div>
        ) : lanVideos.length === 0 ? (
          <div className="p-4 text-nndd-subtext">動画がありません</div>
        ) : (() => {
          const q = lanSearchText.trim().toLowerCase();
          const filtered = q
            ? lanVideos.filter((v) => v.filename.toLowerCase().includes(q) || v.videoId.toLowerCase().includes(q))
            : lanVideos;
          return filtered.length === 0 ? (
            <div className="p-4 text-nndd-subtext">該当する動画はありません</div>
          ) : (
            <table className="nndd-datagrid">
              <thead>
                <tr>
                  <th className="w-28">動画ID</th>
                  <th>タイトル</th>
                  <th className="w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.videoId}>
                    <td className="text-xs text-nndd-subtext">{v.videoId}</td>
                    <td>
                      <span className="inline-block text-[10px] px-1 py-0.5 rounded bg-blue-600/20 text-blue-400 mr-1.5 align-middle">LAN</span>
                      {v.filename || v.videoId}
                    </td>
                    <td>
                      <button
                        onClick={() => void onPlay(v.videoId)}
                        disabled={playingLanId === v.videoId}
                        className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded disabled:opacity-50"
                      >
                        {playingLanId === v.videoId ? '…' : '再生'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
    </>
  );
}
