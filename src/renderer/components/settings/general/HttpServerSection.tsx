import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, CheckRow, Hint, NumberCommitInput, Row, Section, StatusText } from '../common';

/** 設定 > 全般 > 内蔵HTTPサーバー */
export function HttpServerSection(): JSX.Element {
  const [httpStatus, setHttpStatus] = useState<{
    running: boolean;
    port?: number;
    lanIp?: string;
  }>({ running: false });
  const [httpBusy, setHttpBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [allowExternal, setAllowExternal] = useConfig<boolean>('httpServer.allowExternal', false);
  const [allowVideo, setAllowVideo] = useConfig<boolean>('httpServer.allowVideo', true);
  const [allowMyList, setAllowMyList] = useConfig<boolean>('httpServer.allowMyList', true);
  const [httpEnabled, setHttpEnabled] = useConfig<boolean>('httpServer.enabled', false);
  const [httpPort, setHttpPort] = useConfig<number>('httpServer.port', 12345);

  const refreshHttpStatus = (): void => {
    window.nndd
      .invoke<{ running: boolean; port?: number; lanIp?: string }>(
        window.nndd.channels.HTTPD_STATUS
      )
      .then(setHttpStatus)
      .catch(() => setHttpStatus({ running: false }));
  };

  useEffect(() => {
    refreshHttpStatus();
  }, []);

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
                <StatusText kind="ok">● 起動中</StatusText>
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
                      value={`http://${httpStatus.lanIp ?? 'localhost'}:${httpStatus.port}/library`}
                      size={128}
                    />
                  </div>
                )}
                {showQr && (
                  <p className="text-xs text-nndd-subtext mt-1">
                    {httpStatus.lanIp
                      ? `http://${httpStatus.lanIp}:${httpStatus.port}/library`
                      : `http://localhost:${httpStatus.port}/library`}
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
      <div className="mt-3">
        <CheckRow
          checked={allowExternal}
          onChange={async (v) => {
            await setAllowExternal(v);
            refreshHttpStatus();
          }}
          label="LAN内からのアクセスを許可 (スマホ等から閲覧できます)"
        />
        {allowExternal && httpStatus.running && (
          <StatusText kind="warn">設定変更を反映するにはサーバーを再起動してください。</StatusText>
        )}
        {allowExternal && (
          <Hint className="mt-1">
            スマホからアクセスできない場合は Windows ファイアウォールでポート {httpStatus.port ?? 12345} (TCP) の受信規則を許可してください。
          </Hint>
        )}
      </div>
      <CheckRow checked={httpEnabled} onChange={setHttpEnabled} label="起動時に自動起動する" />
      <Row label="ポート">
        <NumberCommitInput value={httpPort} min={1024} max={65535} onCommit={setHttpPort} />
        <Hint>(デフォルト 12345)</Hint>
      </Row>
      <CheckRow
        checked={allowVideo}
        onChange={setAllowVideo}
        label="動画ファイルのストリーミング配信を許可 (スマホ・WEBクライアント用)"
      />
      <CheckRow checked={allowMyList} onChange={setAllowMyList} label="マイリスト情報の共有を許可" />
      <Hint className="mt-2">
        内蔵HTTPサーバーを起動すると、ブラウザから /library でライブラリを閲覧・再生できます。
        ポート変更は再起動後に反映されます。
      </Hint>
    </Section>
  );
}
