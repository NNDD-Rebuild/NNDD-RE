import { useEffect, useState } from 'react';
import type { HistoryItem, NicoWatchHistoryItem, ResumePosition } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';

type HistorySource = 'app' | 'nico';

/**
 * 履歴タブ。
 * 元: NNDD.mxml の Canvas label="履歴"
 *  - アプリ内視聴履歴 / ニコニコ動画本家の視聴履歴 (起動時自動取得) を切替表示
 *  - 履歴クリアボタン (アプリ内履歴のみ)
 */
export function HistoryView(): JSX.Element {
  const activeTab = useAppStore((s) => s.activeTab);
  const [source, setSource] = useState<HistorySource>('app');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [resumes, setResumes] = useState<Record<string, ResumePosition>>({});
  const [nicoItems, setNicoItems] = useState<NicoWatchHistoryItem[]>([]);
  const [nicoLoaded, setNicoLoaded] = useState(false);

  const reload = (): void => {
    window.nndd
      .invoke<HistoryItem[]>(window.nndd.channels.HISTORY_LIST, 1000)
      .then((list) => {
        setItems(list);
        window.nndd
          .invoke<Record<string, ResumePosition>>(IpcChannel.RESUME_LIST_BATCH, list.map((it) => it.videoId))
          .then(setResumes)
          .catch(() => {});
      });
  };

  const reloadNico = (): void => {
    window.nndd
      .invoke<NicoWatchHistoryItem[]>(window.nndd.channels.NICO_HISTORY_LIST)
      .then((list) => {
        setNicoItems(list);
        setNicoLoaded(true);
      })
      .catch(() => setNicoLoaded(true));
  };

  /** 更新ボタン用: ニコニコ本家APIへ差分取得しに行ってからDBの最新件数を反映する */
  const syncNico = (): void => {
    window.nndd
      .invoke<NicoWatchHistoryItem[]>(window.nndd.channels.NICO_HISTORY_SYNC)
      .then((list) => {
        setNicoItems(list);
        setNicoLoaded(true);
      })
      .catch(() => {});
  };

  // 他タブへ移動している間もアンマウントされない (App.tsx で display:none 保持) ため、
  // 履歴タブが再びアクティブになるたびに読み直して新規記録を反映する。
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (source === 'app') reload();
    else if (!nicoLoaded) reloadNico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, source]);

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
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden border border-nndd-border">
            <button
              onClick={() => setSource('app')}
              className={`text-xs px-3 py-1 ${source === 'app' ? 'bg-nndd-accent text-white' : 'bg-nndd-panel hover:bg-nndd-border'}`}
            >
              アプリ内履歴
            </button>
            <button
              onClick={() => setSource('nico')}
              className={`text-xs px-3 py-1 ${source === 'nico' ? 'bg-nndd-accent text-white' : 'bg-nndd-panel hover:bg-nndd-border'}`}
            >
              ニコ動履歴
            </button>
          </div>
          <span className="text-sm text-nndd-subtext">
            {source === 'app' ? `${items.length} 件` : `${nicoItems.length} 件`}
          </span>
        </div>
        {source === 'app' ? (
          <button
            onClick={handleClear}
            className="text-xs px-3 py-1 bg-nndd-border hover:bg-red-700 hover:text-white rounded"
          >
            履歴を全消去
          </button>
        ) : (
          <button
            onClick={syncNico}
            className="text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded"
          >
            更新
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {source === 'app' ? (
          items.length === 0 ? (
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
                {items.map((it, i) => {
                  const resume = resumes[it.videoId];
                  return (
                  <tr key={i} onDoubleClick={() => handlePlay(it.videoId)} className="cursor-pointer">
                    <td>
                      {it.title}
                      {resume && resume.durationSec > 0 && (
                        <span
                          className="ml-2 text-[10px] text-nndd-accent align-middle"
                          title={`${Math.floor(resume.positionSec)}秒 / ${Math.floor(resume.durationSec)}秒`}
                        >
                          ● 続きから ({Math.round((resume.positionSec / resume.durationSec) * 100)}%)
                        </span>
                      )}
                    </td>
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
                  );
                })}
              </tbody>
            </table>
          )
        ) : nicoItems.length === 0 ? (
          <div className="p-4 text-nndd-subtext">
            {nicoLoaded ? 'ニコ動履歴はありません。ニコニコ動画にログインしていない可能性があります。' : '読込中…'}
          </div>
        ) : (
          <table className="nndd-datagrid">
            <thead>
              <tr>
                <th>タイトル</th>
                <th className="w-32">動画ID</th>
                <th className="w-40">視聴日時</th>
                <th className="w-36">操作</th>
              </tr>
            </thead>
            <tbody>
              {nicoItems.map((it, i) => (
                <tr key={i} onDoubleClick={() => handlePlay(it.videoId)} className="cursor-pointer">
                  <td>{it.title}</td>
                  <td>{it.videoId}</td>
                  <td>{it.watchedAt ? new Date(it.watchedAt).toLocaleString('ja-JP') : '-'}</td>
                  <td>
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => handlePlay(it.videoId)}
                        className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded"
                        title="ストリーミングで再生"
                      >
                        ▶
                      </button>
                      <button
                        onClick={() => handleOpenNiconico(it.videoId)}
                        className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-nndd-accent rounded"
                        title="ニコニコ動画で再生"
                      >
                        ニコ動で開く
                      </button>
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
