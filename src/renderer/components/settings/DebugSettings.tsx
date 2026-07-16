import { useEffect, useState } from 'react';

/**
 * 設定 > デバッグ (開発者モード有効時のみ表示)
 *
 * - API ダンプ保存先の選択
 * - ダンプ対象API（Watch、セッション確立、コメント等）の選択
 * - ダンプの有効/無効制御
 */
type ApiDumpTarget = 'watch' | 'session' | 'comment';

export function DebugSettings(): JSX.Element {
  const [apiDumpPath, setApiDumpPath] = useState('');
  const [apiDumpTargets, setApiDumpTargets] = useState<ApiDumpTarget[]>(['watch']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.nndd
      .invoke<string | undefined>(
        window.nndd.channels.CONFIG_GET,
        'developer.apiDumpPath'
      )
      .then((v) => setApiDumpPath(v ?? ''))
      .catch(() => {});
    window.nndd
      .invoke<ApiDumpTarget[] | undefined>(
        window.nndd.channels.CONFIG_GET,
        'developer.apiDumpTargets'
      )
      .then((v) => setApiDumpTargets(v ?? ['watch']))
      .catch(() => {});
  }, []);

  const chooseDir = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      window.nndd.channels.SYS_CHOOSE_DIRECTORY,
      apiDumpPath
    );
    if (dir) {
      setApiDumpPath(dir);
      setSaving(true);
      try {
        await window.nndd.invoke(
          window.nndd.channels.CONFIG_SET,
          'developer.apiDumpPath',
          dir
        );
      } finally {
        setSaving(false);
      }
    }
  };

  const openPath = async (): Promise<void> => {
    if (apiDumpPath) {
      await window.nndd.invoke(
        window.nndd.channels.SYS_OPEN_PATH,
        apiDumpPath
      );
    }
  };

  const toggleTarget = async (target: ApiDumpTarget): Promise<void> => {
    const newTargets = apiDumpTargets.includes(target)
      ? apiDumpTargets.filter((t) => t !== target)
      : [...apiDumpTargets, target];
    setApiDumpTargets(newTargets);
    setSaving(true);
    try {
      await window.nndd.invoke(
        window.nndd.channels.CONFIG_SET,
        'developer.apiDumpTargets',
        newTargets
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">🔧 デバッグ</h2>

      <Section title="API ダンプ">
        <p className="text-xs text-nndd-subtext mb-3">
          動画ストリーミング時に取得するAPIの生データをJSONファイルに保存します。
          開発・デバッグ目的でのみ使用してください。
        </p>

        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-1">保存先:</div>
          <div className="flex items-center gap-2">
            <input
              value={apiDumpPath}
              readOnly
              className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
              placeholder="(未設定の場合、プロジェクトルート直下の apitest フォルダ)"
            />
            <Btn onClick={chooseDir} disabled={saving}>
              参照...
            </Btn>
            <Btn onClick={openPath} disabled={!apiDumpPath}>
              開く
            </Btn>
          </div>
        </div>

        <div className="mb-3">
          <div className="text-xs text-nndd-subtext mb-2">ダンプ対象:</div>
          <div className="space-y-1 pl-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={apiDumpTargets.includes('watch')}
                onChange={() => toggleTarget('watch')}
                disabled={saving}
              />
              <span>Watch v3/v3_guest API</span>
              <span className="text-xs text-nndd-subtext">(動画情報・セッション)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={apiDumpTargets.includes('session')}
                onChange={() => toggleTarget('session')}
                disabled={saving}
              />
              <span>セッション確立 API</span>
              <span className="text-xs text-nndd-subtext">(DMS/DMC)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={apiDumpTargets.includes('comment')}
                onChange={() => toggleTarget('comment')}
                disabled={saving}
              />
              <span>コメント取得 API</span>
              <span className="text-xs text-nndd-subtext">(nvComment v1/threads)</span>
            </label>
          </div>
        </div>

        <p className="text-xs text-nndd-subtext bg-nndd-border/30 p-2 rounded">
          💡 設定を変更すると、次回の動画再生から新しい設定で記録されます。
          環境変数 <code className="bg-nndd-bg px-1 rounded">DEBUG_API_DUMP</code> での設定は不要になります。
        </p>
      </Section>

      <Section title="トラブルシューティング">
        <div className="text-xs text-nndd-subtext space-y-2">
          <div>
            <strong className="text-white">Q: ファイルが生成されない</strong>
            <div className="ml-2 mt-1">
              A: 保存先フォルダが存在するか確認してください。存在しない場合は自動作成されます。
              ダンプ対象が1つ以上チェックされているか確認してください。
            </div>
          </div>
          <div>
            <strong className="text-white">Q: ファイルサイズが大きい</strong>
            <div className="ml-2 mt-1">
              A: Watch v3 APIのレスポンスは数MBになることがあります。
              複数の動画を再生するとフォルダが大きくなるため、不要なファイルは削除してください。
            </div>
          </div>
          <div>
            <strong className="text-white">Q: パフォーマンス低下を感じる</strong>
            <div className="ml-2 mt-1">
              A: ダンプ機能が無効な場合は、開発者モードをオフにしてください。
              設定タブの「開発者オプション」でオフにできます。
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5">
      <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">
        {title}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...props}
      className={[
        'text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded disabled:opacity-50',
        props.className ?? ''
      ].join(' ')}
    />
  );
}
