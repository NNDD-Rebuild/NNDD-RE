import { useEffect, useState } from 'react';

type UpdateEvent =
  | { event: 'checking' }
  | { event: 'available'; info: { version?: string } }
  | { event: 'not-available'; info: { version?: string } }
  | { event: 'progress'; percent: number }
  | { event: 'downloaded'; info: { version?: string } }
  | { event: 'error'; message: string };

/**
 * バージョン情報・自動更新パネル。
 */
export function UpdateSettings(): JSX.Element {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateEvent | null>(null);

  useEffect(() => {
    window.nndd
      .invoke<string>(window.nndd.channels.SYS_GET_VERSION)
      .then(setVersion);
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
      <h2 className="text-base font-bold mb-3">バージョン情報・更新</h2>

      <Section title="現在のバージョン">
        <div className="text-sm">NNDD-RE v{version || '?'}</div>
        <div className="text-xs text-nndd-subtext mt-1">
          オリジナル NNDD V4.4.9 (Adobe AIR) を Electron + TypeScript + React に
          移植したバージョンです。
        </div>
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
