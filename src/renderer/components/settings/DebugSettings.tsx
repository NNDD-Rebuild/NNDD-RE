import { useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, CheckRow, Hint, PageTitle, Section, SettingsPage, TextInput } from './common';

/**
 * 設定 > デバッグ (開発者モード有効時のみ表示)
 *
 * - API ダンプ保存先の選択
 * - ダンプ対象API（Watch、セッション確立、コメント等）の選択
 * - ダンプの有効/無効制御
 */
type ApiDumpTarget = 'watch' | 'session' | 'comment';

const DUMP_TARGETS: { key: ApiDumpTarget; label: string; note: string }[] = [
  { key: 'watch', label: 'Watch v3/v3_guest API', note: '動画情報・セッション' },
  { key: 'session', label: 'セッション確立 API', note: 'DMS/DMC' },
  { key: 'comment', label: 'コメント取得 API', note: 'nvComment v1/threads' }
];

export function DebugSettings(): JSX.Element {
  const [apiDumpPath, setApiDumpPath] = useConfig<string>('developer.apiDumpPath', '');
  const [apiDumpTargets, setApiDumpTargets] = useConfig<ApiDumpTarget[]>('developer.apiDumpTargets', ['watch']);
  const [liveId, setLiveId] = useState('');
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<string[]>([]);

  const runLivePoc = async (): Promise<void> => {
    if (!liveId.trim()) return;
    setLiveRunning(true);
    setLiveResult([]);
    try {
      const lines = await window.nndd.invoke<string[]>(
        window.nndd.channels.LIVE_POC_RUN,
        liveId.trim()
      );
      setLiveResult(lines);
    } catch (e) {
      setLiveResult([`エラー: ${String(e)}`]);
    } finally {
      setLiveRunning(false);
    }
  };

  const chooseDir = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      window.nndd.channels.SYS_CHOOSE_DIRECTORY,
      apiDumpPath
    );
    if (dir) await setApiDumpPath(dir);
  };

  const openPath = async (): Promise<void> => {
    if (apiDumpPath) {
      await window.nndd.invoke(
        window.nndd.channels.SYS_OPEN_PATH,
        apiDumpPath
      );
    }
  };

  const toggleTarget = (target: ApiDumpTarget): void => {
    void setApiDumpTargets(
      apiDumpTargets.includes(target)
        ? apiDumpTargets.filter((t) => t !== target)
        : [...apiDumpTargets, target]
    );
  };

  return (
    <SettingsPage>
      <PageTitle title="🔧 デバッグ" />

      <Section title="API ダンプ">
        <Hint className="mb-3">
          動画ストリーミング時に取得するAPIの生データをJSONファイルに保存します。
          開発・デバッグ目的でのみ使用してください。
        </Hint>

        <div className="mb-3">
          <Hint className="mb-1">保存先:</Hint>
          <div className="flex items-center gap-2">
            <TextInput
              value={apiDumpPath ?? ''}
              readOnly
              className="flex-1"
              placeholder="(未設定の場合、プロジェクトルート直下の apitest フォルダ)"
            />
            <Btn onClick={chooseDir}>参照...</Btn>
            <Btn onClick={openPath} disabled={!apiDumpPath}>
              開く
            </Btn>
          </div>
        </div>

        <div className="mb-3">
          <Hint className="mb-2">ダンプ対象:</Hint>
          <div className="pl-3">
            {DUMP_TARGETS.map((t) => (
              <CheckRow
                key={t.key}
                checked={apiDumpTargets.includes(t.key)}
                onChange={() => toggleTarget(t.key)}
                label={
                  <>
                    {t.label}
                    <span className="text-xs text-nndd-subtext ml-2">({t.note})</span>
                  </>
                }
              />
            ))}
          </div>
        </div>

        <Hint className="bg-nndd-border/30 p-2 rounded">
          💡 設定を変更すると、次回の動画再生から新しい設定で記録されます。
        </Hint>
      </Section>

      <Section title="生放送 視聴フロー調査 (PoC)">
        <Hint className="mb-2">
          番組ID (lv...) を指定して watchページ・視聴WebSocket・HLS・コメントサーバーへ1回ずつ接続し、
          結果をログに出力します。トークン等はマスクされます。
        </Hint>
        <div className="flex items-center gap-2 mb-2">
          <TextInput
            value={liveId}
            onChange={(e) => setLiveId(e.target.value)}
            className="flex-1"
            placeholder="lv123456789"
          />
          <Btn onClick={() => void runLivePoc()} disabled={liveRunning || !liveId.trim()}>
            {liveRunning ? '実行中...' : '実行'}
          </Btn>
        </div>
        {liveResult.length > 0 && (
          <pre className="text-[11px] bg-nndd-bg border border-nndd-border p-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">
            {liveResult.join('\n')}
          </pre>
        )}
      </Section>

      <Section title="トラブルシューティング">
        <div className="space-y-2">
          <div>
            <strong className="text-xs">Q: ファイルが生成されない</strong>
            <Hint className="ml-2 mt-1">
              A: 保存先フォルダが存在するか確認してください。存在しない場合は自動作成されます。
              ダンプ対象が1つ以上チェックされているか確認してください。
            </Hint>
          </div>
          <div>
            <strong className="text-xs">Q: ファイルサイズが大きい</strong>
            <Hint className="ml-2 mt-1">
              A: Watch v3 APIのレスポンスは数MBになることがあります。
              複数の動画を再生するとフォルダが大きくなるため、不要なファイルは削除してください。
            </Hint>
          </div>
          <div>
            <strong className="text-xs">Q: パフォーマンス低下を感じる</strong>
            <Hint className="ml-2 mt-1">
              A: ダンプ機能が無効な場合は、開発者モードをオフにしてください。
              設定タブの「開発者オプション」でオフにできます。
            </Hint>
          </div>
        </div>
      </Section>
    </SettingsPage>
  );
}
