import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useConfig } from '@renderer/hooks/useConfig';
import {
  Btn,
  CheckRow,
  CommitInput,
  Hint,
  NumberCommitInput,
  RadioGroup,
  Row,
  Section,
  StatusText
} from '../common';

type BindMode = 'loopback' | 'lan' | 'tailscale-node';

const BIND_MODES: BindMode[] = ['loopback', 'lan', 'tailscale-node'];

/** Tailscale (サイドカー) の公開状態 */
interface ExposureInfo {
  state: 'idle' | 'starting' | 'needs_login' | 'running' | 'error';
  message?: string;
  authUrl?: string;
  urls: string[];
}

interface HttpStatus {
  running: boolean;
  port?: number;
  lanIp?: string;
  bindMode?: BindMode;
  /** LAN 公開のとき、このPCに Tailscale が入っていればその IP */
  tailscaleIp?: string;
  exposure?: ExposureInfo;
}

/** 設定 > 全般 > 内蔵HTTPサーバー */
export function HttpServerSection(): JSX.Element {
  const [httpStatus, setHttpStatus] = useState<HttpStatus>({ running: false });
  const [httpBusy, setHttpBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // 待受範囲。bindMode が無い設定 (旧バージョン) は allowExternal から導出する
  const [bindModeCfg, setBindModeCfg] = useConfig<string>('httpServer.bindMode', '');
  const [allowExternal, setAllowExternal] = useConfig<boolean>('httpServer.allowExternal', false);
  const bindMode: BindMode = (BIND_MODES as string[]).includes(bindModeCfg)
    ? (bindModeCfg as BindMode)
    : allowExternal ? 'lan' : 'loopback';
  const [allowVideo, setAllowVideo] = useConfig<boolean>('httpServer.allowVideo', true);
  const [allowMyList, setAllowMyList] = useConfig<boolean>('httpServer.allowMyList', true);
  const [httpEnabled, setHttpEnabled] = useConfig<boolean>('httpServer.enabled', false);
  const [httpPort, setHttpPort] = useConfig<number>('httpServer.port', 12345);
  const [allowedHosts, setAllowedHosts] = useConfig<string[]>('httpServer.allowedHosts', []);
  const [nodeHostname, setNodeHostname] = useConfig<string>('httpServer.nodeHostname', 'nndd-re');
  // 端末名が不正なとき、入力欄の下書きを捨てて元に戻すための鍵
  const [hostnameKey, setHostnameKey] = useState(0);

  const refreshHttpStatus = (): void => {
    window.nndd
      .invoke<HttpStatus>(window.nndd.channels.HTTPD_STATUS)
      .then(setHttpStatus)
      .catch(() => setHttpStatus({ running: false }));
  };

  useEffect(() => {
    refreshHttpStatus();
  }, []);

  // 起動中は Tailscale の状態の変化 (ログイン承認など) を反映する
  useEffect(() => {
    if (!httpStatus.running) return;
    const timer = setInterval(refreshHttpStatus, 5000);
    return () => clearInterval(timer);
  }, [httpStatus.running]);

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

  const changeBindMode = async (mode: BindMode): Promise<void> => {
    await setBindModeCfg(mode);
    // 旧バージョンとの互換のため allowExternal も同期する
    await setAllowExternal(mode === 'lan');
    refreshHttpStatus();
  };

  const exposure = httpStatus.exposure;
  // QR・共有用のURL。Tailscale の URL があればそれ、なければ LAN の URL
  const shareUrl =
    exposure?.urls[0] ?? `http://${httpStatus.lanIp ?? 'localhost'}:${httpStatus.port}/library`;
  const qrAvailable = !exposure || exposure.state === 'running';

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
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(`http://127.0.0.1:${httpStatus.port}/library`);
                    }}
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
                {httpStatus.tailscaleIp && (
                  <div className="text-xs text-nndd-subtext mt-1">
                    Tailscale (このPCに導入済み):{' '}
                    <span className="text-green-600 dark:text-green-300">
                      http://{httpStatus.tailscaleIp}:{httpStatus.port}/library
                    </span>
                  </div>
                )}
                {exposure && (
                  <div className="mt-1 space-y-0.5">
                    {exposure.state === 'running' &&
                      exposure.urls.map((u) => (
                        <div key={u} className="text-xs text-nndd-subtext">
                          Tailscale: <span className="text-green-600 dark:text-green-300">{u}</span>
                        </div>
                      ))}
                    {exposure.state === 'starting' && <Hint>Tailscale に接続しています…</Hint>}
                    {(exposure.state === 'needs_login' || exposure.state === 'error') && (
                      <div>
                        <StatusText kind="warn">{exposure.message}</StatusText>
                        {exposure.authUrl && (
                          <>
                            {' '}
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                window.open(exposure.authUrl);
                              }}
                              className="text-xs underline"
                            >
                              ログイン用ページを開く
                            </a>
                          </>
                        )}
                      </div>
                    )}
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
                {showQr && qrAvailable && (
                  <>
                    <div className="mt-2 inline-block bg-white p-3">
                      <QRCodeSVG value={shareUrl} size={128} />
                    </div>
                    <p className="text-xs text-nndd-subtext mt-1">{shareUrl}</p>
                  </>
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
        <Hint className="mb-1">待受範囲</Hint>
        <RadioGroup<BindMode>
          name="httpBindMode"
          direction="column"
          value={bindMode}
          onChange={(m) => void changeBindMode(m)}
          options={[
            { value: 'loopback', label: 'このPCのみ (127.0.0.1)' },
            {
              value: 'lan',
              label: 'LAN内の他端末からのアクセスを許可 (スマホ等から閲覧できます)',
              hint: `認証はありません。信頼できるネットワークでのみ有効にしてください。このPCに Tailscale を入れていれば、同じ設定で外出先からも届きます (アクセスできる端末は Tailscale の管理画面の ACL で絞れます)。スマホからアクセスできない場合は Windows ファイアウォールでポート ${httpStatus.port ?? 12345} (TCP) の受信規則を許可してください。`
            },
            {
              value: 'tailscale-node',
              label: 'Tailscale (NNDD-RE 専用の端末として参加。LAN内からもアクセス可。外部ツールで取得が必要)',
              hint: 'このPCに Tailscale を入れていなくても使えます。NNDD-RE を PC の Tailscale とは別の「専用の端末」として tailnet に参加させます。LAN内の他端末からも、IP アドレスでアクセスできます (LAN公開と同じ。認証はありません)。設定 → 外部ツール で Tailscale を取得し、起動後に表示されるログイン用ページで承認してください。アクセスできる端末は、Tailscale の管理画面の ACL で絞れます (例: 端末にタグ tag:nndd-re を付け、自分の端末だけに許可)。',
              children: (
                <Row label="端末名" hint="MagicDNS 名になります。英小文字・数字・ハイフン">
                  <CommitInput
                    key={hostnameKey}
                    value={nodeHostname}
                    onCommit={(v) => {
                      const name = v.trim().toLowerCase();
                      if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) void setNodeHostname(name);
                      else setHostnameKey((k) => k + 1);
                    }}
                    className="w-40"
                  />
                </Row>
              )
            }
          ]}
        />
        {httpStatus.running && httpStatus.bindMode !== undefined && httpStatus.bindMode !== bindMode && (
          <StatusText kind="warn">設定変更を反映するにはサーバーを再起動してください。</StatusText>
        )}
      </div>

      <Row
        label="追加で許可するホスト名"
        hint="IPアドレス・PC名・*.local・*.ts.net は自動で許可されます。独自ドメイン名でアクセスする場合だけ追加してください (カンマ区切り)。"
      >
        <CommitInput
          placeholder="example.lan, *.example.lan"
          value={allowedHosts.join(', ')}
          onCommit={(v) =>
            void setAllowedHosts(v.split(',').map((h) => h.trim()).filter((h) => h.length > 0))
          }
          className="flex-1 min-w-0"
        />
      </Row>

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
