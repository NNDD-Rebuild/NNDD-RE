import { useEffect, useState } from 'react';
import type { HistoryItem } from '@shared/types';

/**
 * 履歴タブ。
 * 元: NNDD.mxml の Canvas label="履歴"
 *  - 視聴履歴一覧
 *  - 履歴クリアボタン
 */
export function HistoryView(): JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([]);

  const reload = (): void => {
    window.nndd
      .invoke<HistoryItem[]>(window.nndd.channels.HISTORY_LIST, 1000)
      .then(setItems);
  };

  useEffect(reload, []);

  const handleClear = async (): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.HISTORY_CLEAR);
    reload();
  };

  const handlePlay = (videoId: string): void => {
    void window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, { videoId });
  };

  const handleOpenNiconico = (videoId: string): void => {
    void window.nndd.invoke(
      window.nndd.channels.SYS_OPEN_PATH,
      `https://www.nicovideo.jp/watch/${videoId}`
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-2 border-b border-nndd-border bg-nndd-panel">
        <span className="text-sm text-nndd-subtext">
          視聴履歴 ({items.length} 件)
        </span>
        <button
          onClick={handleClear}
          className="text-xs px-3 py-1 bg-nndd-border hover:bg-red-700 hover:text-white rounded"
        >
          履歴を全消去
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="p-4 text-nndd-subtext">履歴はありません。</div>
        ) : (
          <table className="nndd-datagrid">
            <thead>
              <tr>
                <th>タイトル</th>
                <th className="w-32">動画ID</th>
                <th className="w-40">視聴日時</th>
                <th className="w-20">ローカル</th>
                <th className="w-36">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} onDoubleClick={() => handlePlay(it.videoId)} className="cursor-pointer">
                  <td>{it.title}</td>
                  <td>{it.videoId}</td>
                  <td>{it.watchedAt.toLocaleString('ja-JP')}</td>
                  <td>
                    {it.isLocal && <span>○</span>}
                  </td>
                  <td>
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => handlePlay(it.videoId)}
                        className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded"
                        title={it.isLocal ? 'ローカルファイルで再生' : 'ストリーミングで再生'}
                      >
                        ▶
                      </button>
                      {it.videoId && (
                        <button
                          onClick={() => handleOpenNiconico(it.videoId)}
                          className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded"
                          title="ニコニコ動画で再生"
                        >
                          ニコ動で開く
                        </button>
                      )}
                    </div>
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
