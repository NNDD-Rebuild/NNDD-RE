import { useEffect, useState, useCallback } from 'react';

interface LanVideo {
  videoId: string;
  filename: string;
  isEconomy: boolean;
}

interface RemoteNnddConfig {
  enabled: boolean;
  address: string;
  port: number;
}

export function LanLibraryView(): JSX.Element {
  const [config, setConfig] = useState<RemoteNnddConfig | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [videos, setVideos] = useState<LanVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // config は毎回最新を読む (設定変更後に「更新」で反映)
      const cfg = await window.nndd.invoke<RemoteNnddConfig>(
        window.nndd.channels.CONFIG_GET,
        'remoteNndd'
      );
      setConfig(cfg);

      if (!cfg?.enabled || !cfg.address) {
        setReachable(null);
        setVideos([]);
        return;
      }

      const status = await window.nndd.invoke<{ reachable: boolean }>(
        window.nndd.channels.LAN_STATUS
      );
      setReachable(status.reachable);
      if (status.reachable) {
        const list = await window.nndd.invoke<LanVideo[]>(
          window.nndd.channels.LAN_LIBRARY_LIST
        );
        setVideos(list);
      } else {
        setVideos([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePlay = async (videoId: string): Promise<void> => {
    setPlayingId(videoId);
    try {
      const detail = await window.nndd.invoke<{
        videoId: string;
        videoUrl: string;
        extension: string;
        filename: string;
      } | null>(window.nndd.channels.LAN_VIDEO_STREAM, videoId);
      if (!detail) {
        alert('動画情報の取得に失敗しました');
        return;
      }
      await window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, {
        streamUrl: detail.videoUrl
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayingId(null);
    }
  };

  // 設定未完了
  if (config !== null && (!config.enabled || !config.address)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-nndd-subtext">
        <div className="text-lg">LANライブラリが設定されていません</div>
        <div className="text-sm">
          設定 → 全般 → LANライブラリ でアドレスと「参照する」チェックを設定してください。
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-4 py-1.5 text-sm bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-40"
        >
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-nndd-border bg-nndd-panel shrink-0">
        <span className="text-sm text-nndd-subtext">
          {config ? `${config.address}:${config.port}` : '読み込み中...'}
        </span>
        {config?.enabled && (
          <span
            className={[
              'text-xs px-2 py-0.5 rounded-full',
              reachable === true
                ? 'bg-green-600/20 text-green-400'
                : reachable === false
                ? 'bg-red-600/20 text-red-400'
                : 'bg-nndd-border text-nndd-subtext'
            ].join(' ')}
          >
            {reachable === true ? '接続中' : reachable === false ? '接続失敗' : '確認中'}
          </span>
        )}
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto px-3 py-1 text-sm bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-40"
        >
          {loading ? '読込中...' : '更新'}
        </button>
      </div>

      {/* エラー */}
      {error && (
        <div className="px-4 py-2 text-sm text-red-400 bg-red-900/20 border-b border-nndd-border">
          {error}
        </div>
      )}

      {/* 動画一覧 */}
      <div className="flex-1 overflow-y-auto">
        {videos.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">
            {reachable === false ? '接続できませんでした' : '動画がありません'}
          </div>
        )}
        <table className="w-full text-sm">
          <tbody>
            {videos.map((v) => (
              <tr
                key={v.videoId}
                className="border-b border-nndd-border hover:bg-nndd-panel transition-colors"
              >
                <td className="px-4 py-2 text-nndd-subtext w-28 shrink-0">{v.videoId}</td>
                <td className="px-2 py-2 text-nndd-text truncate max-w-0 w-full">
                  {v.filename || v.videoId}
                </td>
                <td className="px-3 py-2 shrink-0">
                  <button
                    onClick={() => handlePlay(v.videoId)}
                    disabled={playingId === v.videoId}
                    className="px-3 py-1 text-xs bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-40"
                  >
                    {playingId === v.videoId ? '...' : '再生'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
