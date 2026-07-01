import { useEffect, useState } from 'react';

type UpdateEvent =
  | { event: 'checking' }
  | { event: 'available'; info: { version?: string } }
  | { event: 'not-available'; info: { version?: string } }
  | { event: 'progress'; percent: number }
  | { event: 'downloaded'; info: { version?: string } }
  | { event: 'error'; message: string };

type AppInfo = {
  version: string;
  userData: string;
  libraryRoot: string;
  dbPath: string;
  cookiePath: string;
  logPath: string;
  cacheDir: string;
};

/**
 * 情報・自動更新パネル。
 */
export function UpdateSettings(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<UpdateEvent | null>(null);

  useEffect(() => {
    window.nndd
      .invoke<AppInfo>(window.nndd.channels.SYS_GET_APP_INFO)
      .then(setInfo);
    const off = window.electron.ipcRenderer.on(
      'nndd:update:event',
      (_e, payload: UpdateEvent) => setStatus(payload)
    );
    return off;
  }, []);

  const check = (): void => {
    window.nndd.invoke(window.nndd.channels.UPDATE_CHECK).catch((e) =>
      setStatus({ event: 'error', message: String(e) })
    );
  };
  const download = (): void => {
    window.nndd.invoke(window.nndd.channels.UPDATE_DOWNLOAD);
  };
  const install = (): void => {
    window.nndd.invoke(window.nndd.channels.UPDATE_INSTALL);
  };

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">情報</h2>

      <Section title="バージョン">
        <div className="text-sm">NNDD-RE v{info?.version ?? '?'}</div>
        <div className="text-xs text-nndd-subtext mt-1">
          オリジナル NNDD V4.4.9 (Adobe AIR) を Electron + TypeScript + React に
          移植したバージョンです。
        </div>
      </Section>

      <Section title="パス情報">
        <div className="text-xs text-nndd-subtext mb-2">クリックでクリップボードにコピー</div>
        {info ? (
          <>
            <CopyRow label="userData" value={info.userData} />
            <CopyRow label="ライブラリDB" value={info.dbPath} />
            <CopyRow label="Cookie" value={info.cookiePath} />
            <CopyRow label="ログ" value={info.logPath} />
            <CopyRow label="キャッシュ" value={info.cacheDir} />
            <CopyRow label="ライブラリ" value={info.libraryRoot} />
          </>
        ) : (
          <div className="text-xs text-nndd-subtext">読み込み中…</div>
        )}
      </Section>

      <Section title="アップデート">
        <div className="flex gap-2 mb-2">
          <Btn onClick={check}>更新を確認</Btn>
          {status?.event === 'available' && <Btn onClick={download}>ダウンロード</Btn>}
          {status?.event === 'downloaded' && (
            <Btn onClick={install}>
              再起動してインストール
            </Btn>
          )}
        </div>
        <div className="text-xs text-nndd-subtext">{describe(status)}</div>
      </Section>
    </div>
  );
}

function describe(s: UpdateEvent | null): string {
  if (!s) return '更新確認は未実行です。';
  switch (s.event) {
    case 'checking':
      return '更新を確認しています…';
    case 'available':
      return `新バージョン ${s.info.version ?? ''} が利用可能です。`;
    case 'not-available':
      return '最新版を使用しています。';
    case 'progress':
      return `ダウンロード中: ${s.percent.toFixed(1)}%`;
    case 'downloaded':
      return `更新ファイル ${s.info.version ?? ''} のダウンロード完了。再起動してください。`;
    case 'error':
      return `エラー: ${s.message}`;
    default:
      return '';
  }
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
        'text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded',
        props.className ?? ''
      ].join(' ')}
    />
  );
}

function CopyRow({ label, value }: { label: string; value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      onClick={copy}
      title="クリックでコピー"
      className="flex items-start gap-2 py-1 px-2 rounded hover:bg-nndd-border cursor-pointer group"
    >
      <span className="text-xs text-nndd-subtext w-28 shrink-0">{label}</span>
      <span className="text-xs font-mono break-all flex-1">{value}</span>
      <span className="text-xs text-nndd-accent opacity-0 group-hover:opacity-100 shrink-0">
        {copied ? '✓' : 'コピー'}
      </span>
    </div>
  );
}
