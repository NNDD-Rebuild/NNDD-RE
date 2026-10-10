import { useState } from 'react';
import { IpcChannel } from '@shared/types';
import { Btn, Hint, PageTitle, SettingsPage, StatusText } from './common';

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
    <SettingsPage>
      <PageTitle title="接続診断">
        ニコニコ動画各エンドポイントへの疎通確認と、ログイン状態の検査を行います。
      </PageTitle>
      <Btn variant="primary" onClick={run} disabled={running} className="mb-4">
        {running ? '実行中…' : '診断を実行'}
      </Btn>

      {error && <div className="mb-3"><StatusText kind="error">エラー: {error}</StatusText></div>}

      {data && (
        <>
          <div className="mb-3 text-sm">
            ログイン状態:{' '}
            {data.loggedIn ? (
              <StatusText kind="ok">● ログイン中</StatusText>
            ) : (
              <StatusText kind="warn">○ 未ログイン</StatusText>
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
                      <StatusText kind="ok">OK</StatusText>
                    ) : (
                      <StatusText kind="error">NG</StatusText>
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
      <Hint className="mb-3">フォロー中タブで使用するAPIエンドポイントの動作確認を行います。</Hint>
      <Btn variant="primary" onClick={runProbe} disabled={probing} className="mb-4">
        {probing ? '診断中…' : 'フォローAPI診断'}
      </Btn>

      {probeError && <div className="mb-3"><StatusText kind="error">エラー: {probeError}</StatusText></div>}

      {probeResults && (
        <div className="p-2 bg-nndd-panel border border-nndd-border rounded text-xs font-mono">
          <div className="font-bold mb-2 flex items-center gap-2">
            診断結果
            <Btn
              onClick={() => {
                const text = probeResults.map(r => `[${r.status || '-'}] ${r.ok ? 'OK' : 'NG'} ${r.url}\n${r.preview}`).join('\n\n');
                navigator.clipboard.writeText(text);
              }}
            >
              コピー
            </Btn>
            <Btn onClick={() => setProbeResults(null)}>×</Btn>
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
    </SettingsPage>
  );
}
