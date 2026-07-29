import { useEffect, useRef, useState } from 'react';

type LogLevel = 'standard' | 'verbose';
type LogRotation = { maxSizeMb: number; maxFiles: number };

export function LogViewer(): JSX.Element {
  const [text, setText] = useState('');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [autoReload, setAutoReload] = useState(true);
  const [logLevel, setLogLevel] = useState<LogLevel>('standard');
  const [logRotation, setLogRotation] = useState<LogRotation>({ maxSizeMb: 1, maxFiles: 3 });
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
    window.nndd
      .invoke<LogLevel>(window.nndd.channels.CONFIG_GET, 'logLevel')
      .then((v) => setLogLevel(v ?? 'standard'));
    window.nndd
      .invoke<LogRotation>(window.nndd.channels.CONFIG_GET, 'logRotation')
      .then((v) => v && setLogRotation(v));
  }, []);

  useEffect(() => {
    if (!autoReload) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [autoReload]);

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

  const handleLogLevelChange = (level: LogLevel): void => {
    setLogLevel(level);
    window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'logLevel', level);
  };

  const handleRotationChange = (patch: Partial<LogRotation>): void => {
    const next = { ...logRotation, ...patch };
    setLogRotation(next);
    window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'logRotation', next);
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

        <div className="ml-2 flex rounded overflow-hidden border border-nndd-border">
          <button
            onClick={() => handleLogLevelChange('standard')}
            className={`text-xs px-3 py-1 ${
              logLevel === 'standard'
                ? 'bg-nndd-accent text-white'
                : 'bg-nndd-panel hover:bg-nndd-border'
            }`}
          >
            標準
          </button>
          <button
            onClick={() => handleLogLevelChange('verbose')}
            className={`text-xs px-3 py-1 ${
              logLevel === 'verbose'
                ? 'bg-nndd-accent text-white'
                : 'bg-nndd-panel hover:bg-nndd-border'
            }`}
          >
            詳細
          </button>
        </div>

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
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs text-nndd-subtext">
        <span>自動ローテーション:</span>
        <label className="flex items-center gap-1">
          上限
          <input
            type="number"
            min={1}
            step={1}
            value={logRotation.maxSizeMb}
            onChange={(e) => handleRotationChange({ maxSizeMb: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs"
          />
          MB
        </label>
        <label className="flex items-center gap-1">
          保持世代数
          <input
            type="number"
            min={1}
            step={1}
            value={logRotation.maxFiles}
            onChange={(e) => handleRotationChange({ maxFiles: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-xs"
          />
        </label>
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
