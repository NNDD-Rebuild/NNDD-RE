import { useEffect, useRef, useState } from 'react';
import { IpcChannel } from '@shared/types';
import { extractLiveIdFromInput } from '@shared/utils/liveId';
import { extractVideoIdFromInput } from '@shared/utils/videoId';

const VIDEO_FILTERS = [
  { name: '動画', extensions: ['mp4', 'm4a', 'flv', 'webm', 'mkv', 'avi', 'mov', 'swf'] },
  { name: 'すべてのファイル', extensions: ['*'] }
];

/** Windows のドライブ/UNC パス、または POSIX の絶対パス */
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/;

/**
 * 「動画を開く」ダイアログ。動画ID/URL またはローカルの動画ファイルを指定して再生する。
 * 元: VideoSourceSelectWindow.mxml
 */
export function OpenVideoDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleBrowse = async (): Promise<void> => {
    const selected = await window.nndd.invoke<string | null>(IpcChannel.SYS_CHOOSE_FILE, VIDEO_FILTERS);
    if (selected) {
      setSource(selected);
      setError(null);
    }
  };

  const handlePlay = async (): Promise<void> => {
    const input = source.trim().replace(/^"(.*)"$/, '$1');
    if (!input) return;
    if (ABSOLUTE_PATH.test(input)) {
      try {
        await window.nndd.invoke(IpcChannel.VIDEO_OPEN_FILE, input);
        onClose();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
      }
      return;
    }
    const videoId = extractVideoIdFromInput(input);
    if (videoId) {
      await window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId });
      onClose();
      return;
    }
    setError(
      extractLiveIdFromInput(input)
        ? '生放送は「生放送」タブから開いてください'
        : '動画ID・URL・ファイルのパスのいずれかを入力してください'
    );
  };

  const handleDrop = (e: React.DragEvent): void => {
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!first) return;
    e.preventDefault();
    setSource(first);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[34rem] max-w-[90vw] p-4 bg-nndd-panel border border-nndd-border rounded shadow-lg space-y-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="text-sm font-semibold">動画を開く</div>
        <label className="block text-xs text-nndd-subtext">
          動画のソースまたは動画IDを入力 (URLのドロップも可)
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={source}
            onChange={(e) => { setSource(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handlePlay();
              if (e.key === 'Escape') onClose();
            }}
            placeholder="sm12345 / https://www.nicovideo.jp/watch/sm12345 / C:\videos\sample.mp4"
            className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <button
            onClick={() => void handleBrowse()}
            className="text-xs px-3 py-1 bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white"
          >
            参照...
          </button>
        </div>
        {error && <div className="text-xs text-red-500 dark:text-red-400">⚠ {error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 bg-nndd-border text-nndd-text rounded hover:opacity-80"
          >
            閉じる
          </button>
          <button
            onClick={() => void handlePlay()}
            className="text-xs px-4 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
          >
            再生
          </button>
        </div>
      </div>
    </div>
  );
}
