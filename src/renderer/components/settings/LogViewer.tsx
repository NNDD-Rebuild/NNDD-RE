import { useEffect, useRef, useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, ButtonGroup, NumberCommitInput } from './common';

type LogLevel = 'standard' | 'verbose';
type LogRotation = { maxSizeMb: number; maxFiles: number };

export function LogViewer(): JSX.Element {
  const [text, setText] = useState('');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [autoReload, setAutoReload] = useState(true);
  const [logLevel, setLogLevel] = useConfig<LogLevel>('logLevel', 'standard');
  const [logRotation, setLogRotation] = useConfig<LogRotation>('logRotation', { maxSizeMb: 1, maxFiles: 3 });
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

  const handleRotationChange = (patch: Partial<LogRotation>): void => {
    void setLogRotation({ ...logRotation, ...patch });
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

        <div className="ml-2">
          <ButtonGroup
            value={logLevel}
            onChange={(v) => void setLogLevel(v)}
            options={[
              { value: 'standard', label: '標準' },
              { value: 'verbose', label: '詳細' }
            ]}
          />
        </div>

        <label className="text-xs text-nndd-subtext ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoReload}
            onChange={(e) => setAutoReload(e.target.checked)}
          />
          自動再読込
        </label>
        <Btn onClick={load}>再読込</Btn>
        <Btn onClick={handleOpen} disabled={!logPath}>
          ファイルを開く
        </Btn>
        <Btn variant="danger" onClick={handleClear}>
          ログをクリア
        </Btn>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-nndd-border bg-nndd-panel text-xs text-nndd-subtext">
        <span>自動ローテーション:</span>
        <label className="flex items-center gap-1">
          上限
          <NumberCommitInput
            min={1}
            step={1}
            className="w-16"
            value={logRotation.maxSizeMb}
            onCommit={(v) => handleRotationChange({ maxSizeMb: Math.floor(v) })}
          />
          MB
        </label>
        <label className="flex items-center gap-1">
          保持世代数
          <NumberCommitInput
            min={1}
            step={1}
            className="w-16"
            value={logRotation.maxFiles}
            onCommit={(v) => handleRotationChange({ maxFiles: Math.floor(v) })}
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
