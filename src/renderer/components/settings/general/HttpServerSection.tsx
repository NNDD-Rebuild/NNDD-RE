import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Section, Btn } from '../common';

/** 設定 > 全般 > 内蔵HTTPサーバー */
export function HttpServerSection(): JSX.Element {
  const [httpStatus, setHttpStatus] = useState<{
    running: boolean;
    port?: number;
    lanIp?: string;
  }>({ running: false });
  const [httpBusy, setHttpBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [allowExternal, setAllowExternal] = useState(false);
  const [allowVideo, setAllowVideo] = useState(true);
  const [allowMyList, setAllowMyList] = useState(true);
  const [httpEnabled, setHttpEnabled] = useConfig<boolean>('httpServer.enabled', false);
  const [httpPort, setHttpPort] = useConfig<number>('httpServer.port', 12345);
  const [requireToken, setRequireToken] = useConfig<boolean>('httpServer.requireToken', false);
  const [allowedHosts, setAllowedHosts] = useConfig<string[]>('httpServer.allowedHosts', []);
  const [allowedHostsText, setAllowedHostsText] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const refreshHttpStatus = (): void => {
    window.nndd
      .invoke<{ running: boolean; port?: number; lanIp?: string }>(
        window.nndd.channels.HTTPD_STATUS
      )
      .then(setHttpStatus)
      .catch(() => setHttpStatus({ running: false }));
  };

  useEffect(() => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'httpServer.allowExternal')
      .then((v) => setAllowExternal(v === true))
      .catch(() => {});
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'httpServer.allowVideo')
      .then((v) => setAllowVideo(v !== false))
      .catch(() => {});
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'httpServer.allowMyList')
      .then((v) => setAllowMyList(v !== false))
      .catch(() => {});
    refreshHttpStatus();
  }, []);

  useEffect(() => { setAllowedHostsText(allowedHosts.join(', ')); }, [allowedHosts]);

  // トークン認証が有効なときだけトークンを取得する (QR・表示用)
  useEffect(() => {
    if (!requireToken) { setToken(null); return; }
    window.nndd
      .invoke<{ token: string }>(window.nndd.channels.HTTPD_TOKEN_GET)
      .then((r) => setToken(r.token))
      .catch(() => setToken(null));
  }, [requireToken]);

  const handleRegenerateToken = async (): Promise<void> => {
    if (!window.confirm('アクセストークンを再生成します。以前のQRコード・URLは使えなくなります。よろしいですか？')) return;
    const r = await window.nndd.invoke<{ token: string }>(window.nndd.channels.HTTPD_TOKEN_REGENERATE);
    setToken(r.token);
  };

  const withToken = (url: string): string =>
    requireToken && token ? `${url}?token=${encodeURIComponent(token)}` : url;

  const handleHttpStart = async (): Promise<void> => {
    setHttpBusy(true);
    try {
      await window.nndd.invoke(window.nndd.channels.HTTPD_START);
      refreshHttpStatus();
    } finally {
      setHttpBusy(false);
    }
  };

  const handleHttpStop = async (): Promise<void> => {
    setHttpBusy(true);
    try {
      await window.nndd.invoke(window.nndd.channels.HTTPD_STOP);
      refreshHttpStatus();
    } finally {
      setHttpBusy(false);
    }
  };

  return (
    <Section title="内蔵HTTPサーバー">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-sm">
          {httpStatus.running ? (
            <>
              <div>
                <span className="text-green-600 dark:text-green-400">● 起動中</span>
                <span className="ml-2 text-xs text-nndd-subtext">
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); window.open(`http://127.0.0.1:${httpStatus.port}/library`); }}
                    className="underline"
                  >
                    http://127.0.0.1:{httpStatus.port}/library
                  </a>
                </span>
                {httpStatus.lanIp && (
                  <div className="text-xs text-nndd-subtext mt-1">
                    LAN:{' '}
                    <span className="text-green-600 dark:text-green-300">
                      http://{httpStatus.lanIp}:{httpStatus.port}/library
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-2">
                <button
                  onClick={() => setShowQr((v) => !v)}
                  className="text-xs underline text-nndd-subtext"
                >
                  {showQr ? 'QRコードを隠す' : 'QRコードを表示'}
                </button>
                {showQr && (
                  <div className="mt-2 inline-block bg-white p-3">
                    <QRCodeSVG
                      value={withToken(`http://${httpStatus.lanIp ?? 'localhost'}:${httpStatus.port}/library`)}
                      size={128}
                    />
                  </div>
                )}
                {showQr && (
                  <p className="text-xs text-nndd-subtext mt-1">
                    {httpStatus.lanIp
                      ? `http://${httpStatus.lanIp}:${httpStatus.port}/library`
                      : `http://localhost:${httpStatus.port}/library`}
                    {requireToken && ' (QRコードにはアクセストークンが含まれます)'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <span className="text-nndd-subtext">○ 停止中</span>
          )}
        </div>
        {!httpStatus.running ? (
          <Btn onClick={handleHttpStart} disabled={httpBusy}>
            {httpBusy ? '処理中…' : '起動'}
          </Btn>
        ) : (
          <Btn onClick={handleHttpStop} disabled={httpBusy}>
            {httpBusy ? '処理中…' : '停止'}
          </Btn>
        )}
      </div>
      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={allowExternal}
          onChange={async (e) => {
            const v = e.target.checked;
            setAllowExternal(v);
            await window.nndd.invoke(
              window.nndd.channels.CONFIG_SET,
              'httpServer.allowExternal',
              v
            );
            refreshHttpStatus();
          }}
        />
        LAN内からのアクセスを許可 (スマホ等から閲覧できます)
      </label>
      {allowExternal && httpStatus.running && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
          設定変更を反映するにはサーバーを再起動してください。
        </p>
      )}
      {allowExternal && (
        <p className="text-xs text-nndd-subtext mt-1">
          スマホからアクセスできない場合は Windows ファイアウォールでポート {httpStatus.port ?? 12345} (TCP) の受信規則を許可してください。
        </p>
      )}
      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={httpEnabled}
          onChange={(e) => setHttpEnabled(e.target.checked)}
        />
        起動時に自動起動する
      </label>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-nndd-subtext w-12 shrink-0">ポート</span>
        <input
          type="number"
          min={1024}
          max={65535}
          value={httpPort}
          onChange={(e) => setHttpPort(Number(e.target.value))}
          className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
        <span className="text-xs text-nndd-subtext">(デフォルト 12345)</span>
      </div>
      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={requireToken}
          onChange={(e) => setRequireToken(e.target.checked)}
        />
        アクセストークンを要求する (QRコード・URLのトークンが無いと開けません)
      </label>
      {requireToken && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-nndd-subtext w-12 shrink-0">トークン</span>
          <input
            type={showToken ? 'text' : 'password'}
            readOnly
            value={token ?? ''}
            className="flex-1 min-w-0 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm font-mono"
          />
          <Btn onClick={() => setShowToken((v) => !v)}>{showToken ? '隠す' : '表示'}</Btn>
          <Btn onClick={handleRegenerateToken}>再生成</Btn>
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-nndd-subtext shrink-0">追加で許可するホスト名</span>
        <input
          type="text"
          placeholder="example.lan, *.example.lan"
          value={allowedHostsText}
          onChange={(e) => setAllowedHostsText(e.target.value)}
          onBlur={() =>
            setAllowedHosts(
              allowedHostsText.split(',').map((h) => h.trim()).filter((h) => h.length > 0)
            )
          }
          className="flex-1 min-w-0 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
      </div>
      <p className="text-xs text-nndd-subtext mt-1">
        IPアドレス・PC名・*.local・*.ts.net は自動で許可されます。独自ドメイン名でアクセスする場合だけ追加してください。
      </p>
      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={allowVideo}
          onChange={async (e) => {
            const v = e.target.checked;
            setAllowVideo(v);
            await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'httpServer.allowVideo', v);
          }}
        />
        動画ファイルのストリーミング配信を許可 (スマホ・WEBクライアント用)
      </label>
      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={allowMyList}
          onChange={async (e) => {
            const v = e.target.checked;
            setAllowMyList(v);
            await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'httpServer.allowMyList', v);
          }}
        />
        マイリスト情報の共有を許可
      </label>
      <p className="text-xs text-nndd-subtext mt-2">
        内蔵HTTPサーバーを起動すると、ブラウザから /library でライブラリを閲覧・再生できます。
        ポート変更は再起動後に反映されます。
      </p>
    </Section>
  );
}
