import { useEffect, useState } from 'react';
import type { DownloadQueueItem, MyListItem } from '@shared/types';
import { DownloadStatusType, IpcChannel } from '@shared/types';

/**
 * DLリストタブ。
 * 元: NNDD.mxml の Canvas label="DLリスト"
 *
 * ダウンロードキュー一覧、進捗バー、新規追加、キャンセル/リトライ/削除。
 * コメントは fetchAllComments で過去ログ含む全量を自動取得。
 */
export function DownloadView(): JSX.Element {
  const [items, setItems] = useState<DownloadQueueItem[]>([]);
  const [videoId, setVideoId] = useState('');
  const [mylistAdding, setMylistAdding] = useState(false);
  const [mylistError, setMylistError] = useState<string | null>(null);

  const reload = (): void => {
    window.nndd
      .invoke<DownloadQueueItem[]>(window.nndd.channels.DOWNLOAD_LIST)
      .then(setItems);
  };

  useEffect(() => {
    reload();
    const off = window.nndd.on(
      window.nndd.channels.DOWNLOAD_PROGRESS_EVENT,
      () => reload()
    );
    return off;
  }, []);

  const handleAdd = async (): Promise<void> => {
    const id = videoId.trim();
    if (!id) return;

    // マイリストURL検出: nicovideo.jp/.../mylist/数字 を含む場合
    const mylistMatch = id.match(/nicovideo\.jp(?:\/user\/\d+)?\/mylist\/(\d+)/);
    if (mylistMatch) {
      setMylistAdding(true);
      setMylistError(null);
      try {
        const mlItems = await window.nndd.invoke<MyListItem[]>(
          window.nndd.channels.MYLIST_RENEW,
          id
        );
        for (const it of mlItems) {
          await window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId: it.videoId });
        }
        setVideoId('');
        reload();
      } catch (e) {
        setMylistError(e instanceof Error ? e.message : String(e));
      } finally {
        setMylistAdding(false);
      }
      return;
    }

    // シリーズURL検出: nicovideo.jp/.../series/数字 を含む場合
    const seriesMatch = id.match(/nicovideo\.jp(?:\/user\/\d+)?\/series\/(\d+)/);
    if (seriesMatch) {
      setMylistAdding(true);
      setMylistError(null);
      try {
        const seriesData = await window.nndd.invoke<{ name: string; items: { videoId: string; title: string }[] }>(
          IpcChannel.SERIES_FETCH,
          seriesMatch[1]
        );
        for (const it of seriesData.items) {
          await window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, { videoId: it.videoId });
        }
        setVideoId('');
        reload();
      } catch (e) {
        setMylistError(e instanceof Error ? e.message : String(e));
      } finally {
        setMylistAdding(false);
      }
      return;
    }

    await window.nndd.invoke(window.nndd.channels.DOWNLOAD_ENQUEUE, {
      videoId: id
    });
    setVideoId('');
    reload();
  };

  const handleCancel = (id: string): void => {
    window.nndd
      .invoke(window.nndd.channels.DOWNLOAD_CANCEL, id)
      .then(reload);
  };
  const handleRemove = (id: string): void => {
    window.nndd
      .invoke(window.nndd.channels.DOWNLOAD_REMOVE, id)
      .then(reload);
  };
  const handleRetry = (id: string): void => {
    window.nndd
      .invoke(window.nndd.channels.DOWNLOAD_RETRY, id)
      .then(reload);
  };
  const handleClearCompleted = (): void => {
    window.nndd
      .invoke(window.nndd.channels.DOWNLOAD_CLEAR_COMPLETED)
      .then(reload);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
        <input
          value={videoId}
          onChange={(e) => { setVideoId(e.target.value); setMylistError(null); }}
          placeholder="動画ID (例: sm12345)、URL、またはマイリストURL"
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button
          onClick={handleAdd}
          disabled={mylistAdding}
          className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
        >
          {mylistAdding ? 'マイリスト取得中…' : 'DLリストに追加'}
        </button>
        {mylistError && (
          <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-xs" title={mylistError}>
            ⚠ {mylistError}
          </span>
        )}
        <button
          onClick={handleClearCompleted}
          className="text-xs px-3 py-1 bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white"
        >
          完了済みをクリア
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="p-4 text-nndd-subtext">
            キューに項目はありません。動画IDを入力して追加してください。
          </div>
        ) : (
          <table className="nndd-datagrid">
            <thead>
              <tr>
                <th className="w-32">状態</th>
                <th>動画名</th>
                <th className="w-32">進捗</th>
                <th className="w-32">メッセージ</th>
                <th className="w-48">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{statusLabel(it.status)}</td>
                  <td title={it.videoId}>
                    {it.videoName || it.videoId}
                    <span className="text-nndd-subtext ml-2 text-xs">
                      ({it.videoId})
                    </span>
                  </td>
                  <td>
                    <div className="w-full bg-nndd-border h-2 rounded overflow-hidden">
                      <div
                        className="h-2 bg-nndd-accent"
                        style={{ width: `${Math.floor(it.progress * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-nndd-subtext">
                      {Math.floor(it.progress * 100)}%
                    </span>
                  </td>
                  <td className="text-xs text-nndd-subtext">{it.message}</td>
                  <td>
                    {isRunning(it.status) && (
                      <button
                        onClick={() => handleCancel(it.id)}
                        className="text-xs px-2 py-1 bg-nndd-border hover:bg-red-700 hover:text-white rounded mr-1"
                      >
                        キャンセル
                      </button>
                    )}
                    {(it.status === DownloadStatusType.FAIL ||
                      it.status === DownloadStatusType.CANCELED) && (
                      <button
                        onClick={() => handleRetry(it.id)}
                        className="text-xs px-2 py-1 bg-nndd-border hover:bg-nndd-accent rounded mr-1"
                      >
                        リトライ
                      </button>
                    )}
                    {!isRunning(it.status) && (
                      <button
                        onClick={() => handleRemove(it.id)}
                        className="text-xs px-2 py-1 bg-nndd-border hover:bg-red-700 hover:text-white rounded"
                      >
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case DownloadStatusType.WAIT:       return '待機中';
    case DownloadStatusType.LOGIN:      return 'ログイン中';
    case DownloadStatusType.WATCH:      return '視聴ページ取得';
    case DownloadStatusType.COMMENT:    return 'コメント取得';
    case DownloadStatusType.OWNER_COMMENT: return '投コメ取得';
    case DownloadStatusType.THUMB:      return 'サムネ取得';
    case DownloadStatusType.MASTER_PLAYLIST: return 'プレイリスト解析';
    case DownloadStatusType.KEY:        return '鍵取得';
    case DownloadStatusType.SEGMENT:    return 'セグメントDL';
    case DownloadStatusType.MERGE:      return '結合中';
    case DownloadStatusType.VIDEO:      return '動画取得';
    case DownloadStatusType.SUCCESS:    return '完了';
    case DownloadStatusType.FAIL:       return '失敗';
    case DownloadStatusType.CANCELED:   return 'キャンセル';
    case DownloadStatusType.SKIPPED:    return 'スキップ';
    default: return s;
  }
}

function isRunning(s: string): boolean {
  return [
    DownloadStatusType.LOGIN,
    DownloadStatusType.WATCH,
    DownloadStatusType.COMMENT,
    DownloadStatusType.OWNER_COMMENT,
    DownloadStatusType.THUMB,
    DownloadStatusType.MASTER_PLAYLIST,
    DownloadStatusType.KEY,
    DownloadStatusType.SEGMENT,
    DownloadStatusType.MERGE,
    DownloadStatusType.VIDEO
  ].includes(s as typeof DownloadStatusType[keyof typeof DownloadStatusType]);
}
