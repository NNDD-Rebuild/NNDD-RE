import { useState } from 'react';
import { IpcChannel } from '@shared/types';

interface DiagResult {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  message?: string;
  durationMs: number;
}

interface DiagResponse {
  loggedIn: boolean;
  results: DiagResult[];
}

interface ProbeResult {
  url: string;
  status: number;
  ok: boolean;
  preview: string;
}

/**
 * 接続診断パネル。
 * 元: NNDD.mxml の Canvas label="接続診断"
 */
export function ConnectionDiagnostics(): JSX.Element {
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<DiagResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [probing, setProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[] | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const r = await window.nndd.invoke<DiagResponse>(
        window.nndd.channels.DIAG_RUN
      );
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const runProbe = async (): Promise<void> => {
    setProbing(true);
    setProbeError(null);
    setProbeResults(null);
    try {
      const r = await window.nndd.invoke<ProbeResult[]>(IpcChannel.FOLLOW_PROBE);
      setProbeResults(r);
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">接続診断</h2>
      <p className="text-xs text-nndd-subtext mb-3">
        ニコニコ動画各エンドポイントへの疎通確認と、ログイン状態の検査を行います。
      </p>
      <button
        onClick={run}
        disabled={running}
        className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50 mb-4"
      >
        {running ? '実行中…' : '診断を実行'}
      </button>

      {error && (
        <div className="text-red-500 dark:text-red-400 text-sm mb-3">エラー: {error}</div>
      )}

      {data && (
        <>
          <div className="mb-3 text-sm">
            ログイン状態:{' '}
            {data.loggedIn ? (
              <span className="text-green-600 dark:text-green-400">● ログイン中</span>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">○ 未ログイン</span>
            )}
          </div>
          <table className="nndd-datagrid mb-6">
            <thead>
              <tr>
                <th className="w-16">結果</th>
                <th>エンドポイント</th>
                <th className="w-16">HTTP</th>
                <th className="w-20">応答時間</th>
                <th>詳細</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.url}>
                  <td>
                    {r.ok ? (
                      <span className="text-green-600 dark:text-green-400">OK</span>
                    ) : (
                      <span className="text-red-500 dark:text-red-400">NG</span>
                    )}
                  </td>
                  <td>
                    <div>{r.name}</div>
                    <div
                      className="text-[10px] text-nndd-subtext truncate"
                      title={r.url}
                    >
                      {r.url}
                    </div>
                  </td>
                  <td>{r.status ?? '-'}</td>
                  <td>{r.durationMs}ms</td>
                  <td className="text-xs">{r.message ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* フォロー新着API診断 */}
      <hr className="border-nndd-border mb-4" />
      <h3 className="text-sm font-bold mb-2">フォロー新着API診断</h3>
      <p className="text-xs text-nndd-subtext mb-3">
        フォロー中タブで使用するAPIエンドポイントの動作確認を行います。
      </p>
      <button
        onClick={runProbe}
        disabled={probing}
        className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50 mb-4"
      >
        {probing ? '診断中…' : 'フォローAPI診断'}
      </button>

      {probeError && (
        <div className="text-red-500 dark:text-red-400 text-sm mb-3">エラー: {probeError}</div>
      )}

      {probeResults && (
        <div className="p-2 bg-nndd-panel border border-nndd-border rounded text-xs font-mono">
          <div className="font-bold mb-2 flex items-center gap-2">
            診断結果
            <button
              onClick={() => {
                const text = probeResults.map(r => `[${r.status || '-'}] ${r.ok ? 'OK' : 'NG'} ${r.url}\n${r.preview}`).join('\n\n');
                navigator.clipboard.writeText(text);
              }}
              className="text-nndd-subtext hover:text-nndd-text text-[10px] px-1.5 py-0.5 border border-nndd-border rounded"
            >コピー</button>
            <button onClick={() => setProbeResults(null)} className="text-nndd-subtext hover:text-red-500 dark:hover:text-red-400">×</button>
          </div>
          {probeResults.map((r, i) => (
            <div key={i} className={`mb-3 ${r.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
              <div>
                <span className="font-bold">[{r.status || '-'}]</span>{' '}
                <span className="text-nndd-text break-all">{r.url}</span>
              </div>
              <div className="text-nndd-subtext mt-0.5 whitespace-pre-wrap break-all text-[10px]">
                {r.preview.slice(0, 400)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
