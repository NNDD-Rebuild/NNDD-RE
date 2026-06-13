import { useEffect, useRef, useState } from 'react';

/**
 * ログビューア。
 * 元: NNDD.mxml の Canvas label="ログ"
 *
 *  - アプリログ末尾を表示
 *  - 自動再読込 (3秒間隔)
 *  - クリア / ログファイルを開く
 */
export function LogViewer(): JSX.Element {
  const [text, setText] = useState('');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [autoReload, setAutoReload] = useState(true);
  const ref = useRef<HTMLPreElement>(null);

  const load = (): void => {
    window.nndd
      .invoke<string>(window.nndd.channels.LOG_READ, 128 * 1024)
      .then(setText)
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    window.nndd
      .invoke<string | null>(window.nndd.channels.LOG_GET_PATH)
      .then(setLogPath);
  }, []);

  useEffect(() => {
    if (!autoReload) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [autoReload]);

  // 末尾までスクロール
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text]);

  const handleClear = async (): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.LOG_CLEAR);
    load();
  };

  const handleOpen = (): void => {
    if (logPath) {
      window.nndd.invoke(window.nndd.channels.SYS_OPEN_PATH, logPath);
    }
  };

  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex items-center gap-2 p-2 border-b border-nndd-border bg-nndd-panel">
        <span className="text-sm font-bold">アプリログ</span>
        <span
          className="text-xs text-nndd-subtext truncate max-w-xs"
          title={logPath ?? ''}
        >
          {logPath}
        </span>
        <label className="text-xs text-nndd-subtext ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoReload}
            onChange={(e) => setAutoReload(e.target.checked)}
          />
          自動再読込
        </label>
        <button
          onClick={load}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent"
        >
          再読込
        </button>
        <button
          onClick={handleOpen}
          disabled={!logPath}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
        >
          ファイルを開く
        </button>
        <button
          onClick={handleClear}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-red-700 hover:text-white"
        >
          ログをクリア
        </button>
      </div>
      <pre
        ref={ref}
        className="flex-1 overflow-auto bg-black/40 p-2 text-xs font-mono whitespace-pre-wrap"
      >
        {text || '(ログはまだありません)'}
      </pre>
    </div>
  );
}
