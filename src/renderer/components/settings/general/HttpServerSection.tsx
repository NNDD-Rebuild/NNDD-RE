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
  StatusText,
  TextInput
} from '../common';

type BindMode = 'loopback' | 'lan' | 'tailscale' | 'tailscale-serve' | 'tailscale-node';

const BIND_MODES: BindMode[] = ['loopback', 'lan', 'tailscale', 'tailscale-serve', 'tailscale-node'];

/** Tailscale への公開 (serve / 独立端末) の状態 */
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
  tailscaleIp?: string;
  waitingForTailscale?: boolean;
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
  const [requireToken, setRequireToken] = useConfig<boolean>('httpServer.requireToken', false);
  const [allowedHosts, setAllowedHosts] = useConfig<string[]>('httpServer.allowedHosts', []);
  const [serveHttpsPort, setServeHttpsPort] = useConfig<number>('httpServer.serveHttpsPort', 8443);
  const [nodeHostname, setNodeHostname] = useConfig<string>('httpServer.nodeHostname', 'nndd-re');
  const [nodeHttps, setNodeHttps] = useConfig<boolean>('httpServer.nodeHttps', false);
  const [nodeEphemeral, setNodeEphemeral] = useConfig<boolean>('httpServer.nodeEphemeral', false);
  // 端末名が不正なとき、入力欄の下書きを捨てて元に戻すための鍵
  const [hostnameKey, setHostnameKey] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const refreshHttpStatus = (): void => {
    window.nndd
      .invoke<HttpStatus>(window.nndd.channels.HTTPD_STATUS)
      .then(setHttpStatus)
      .catch(() => setHttpStatus({ running: false }));
  };

  useEffect(() => {
    refreshHttpStatus();
  }, []);

  // 起動中は Tailscale の接続状態の変化 (待機 → 接続、ログイン承認など) を反映する
  useEffect(() => {
    if (!httpStatus.running) return;
    const timer = setInterval(refreshHttpStatus, 5000);
    return () => clearInterval(timer);
  }, [httpStatus.running]);

  // tailscale 系のモードはトークン必須
  const tokenActive = requireToken || bindMode.startsWith('tailscale');

  // トークン認証が有効なときだけトークンを取得する (QR・表示用)
  useEffect(() => {
    if (!tokenActive) {
      setToken(null);
      return;
    }
    window.nndd
      .invoke<{ token: string }>(window.nndd.channels.HTTPD_TOKEN_GET)
      .then((r) => setToken(r.token))
      .catch(() => setToken(null));
  }, [tokenActive]);

  const handleRegenerateToken = async (): Promise<void> => {
    if (!window.confirm('アクセストークンを再生成します。以前のQRコード・URLは使えなくなります。よろしいですか？')) return;
    const r = await window.nndd.invoke<{ token: string }>(window.nndd.channels.HTTPD_TOKEN_REGENERATE);
    setToken(r.token);
  };

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

  // QR・共有用のURL (トークンなし)。Tailscale への公開 (serve / 独立端末) があればその URL を使う
  const shareUrl =
    httpStatus.exposure?.urls[0] ??
    `http://${httpStatus.tailscaleIp ?? httpStatus.lanIp ?? 'localhost'}:${httpStatus.port}/library`;
  const withToken = (url: string): string =>
    tokenActive && token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const exposure = httpStatus.exposure;
  const exposureReady = !exposure || exposure.state === 'running';
  const qrAvailable = !httpStatus.waitingForTailscale && exposureReady;
  const isTailscaleRunning = httpStatus.bindMode?.startsWith('tailscale') ?? false;

  return (
    <Section title="内蔵HTTPサーバー">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-sm">
          {httpStatus.running ? (
            <>
              <div>
                <StatusText kind="ok">● 起動中</StatusText>
                {!isTailscaleRunning && (
                  <span className="ml-2 text-xs text-nndd-subtext">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(withToken(`http://127.0.0.1:${httpStatus.port}/library`));
                      }}
                      className="underline"
                    >
                      http://127.0.0.1:{httpStatus.port}/library
                    </a>
                  </span>
                )}
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
                    Tailscale:{' '}
                    <span className="text-green-600 dark:text-green-300">
                      http://{httpStatus.tailscaleIp}:{httpStatus.port}/library
                    </span>
                  </div>
                )}
                {httpStatus.waitingForTailscale && (
                  <div className="mt-1">
                    <StatusText kind="warn">
                      Tailscale の接続を待っています (Tailscale を起動してログインすると自動で待受を開始します)
                    </StatusText>
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
                    {exposure.state === 'starting' && <Hint>Tailscale の公開を設定しています…</Hint>}
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
                      <QRCodeSVG value={withToken(shareUrl)} size={128} />
                    </div>
                    <p className="text-xs text-nndd-subtext mt-1">
                      {shareUrl}
                      {tokenActive && ' (QRコードにはアクセストークンが含まれます)'}
                    </p>
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
              hint: `スマホからアクセスできない場合は Windows ファイアウォールでポート ${httpStatus.port ?? 12345} (TCP) の受信規則を許可してください。`
            },
            {
              value: 'tailscale',
              label: 'Tailscale 経由のみ許可 (外出先から。アクセストークン必須)',
              hint: 'このPCと閲覧する端末の両方に Tailscale を入れ、同じ tailnet に参加してください。Tailscale の IP (100.x.x.x) にだけ待ち受けるため、LAN内の他端末からは届きません。LAN内のスマホからも使う場合は「LAN内の他端末からのアクセスを許可」を選んでください。'
            },
            {
              value: 'tailscale-serve',
              label: 'Tailscale Serve で HTTPS 公開 (導入済みの Tailscale を使用。アクセストークン必須)',
              hint: '導入済みの Tailscale の `tailscale serve` で HTTPS 公開します (127.0.0.1 で待受し、LAN内には公開されません)。Tailscale の管理画面で MagicDNS と HTTPS 証明書を有効にしてください。既存の serve 設定は変更せず、ここで作った設定だけを停止時に外します。',
              children: (
                <Row label="HTTPSポート" hint="(デフォルト 8443。443 は他の用途と衝突しやすいため非推奨)">
                  <NumberCommitInput value={serveHttpsPort} min={1} max={65535} onCommit={setServeHttpsPort} />
                </Row>
              )
            },
            {
              value: 'tailscale-node',
              label: 'Tailscale 独立端末 (NNDD-RE 専用の端末として参加。外部ツールで取得が必要。アクセストークン必須)',
              hint: 'NNDD-RE を PC の Tailscale とは別の「専用の端末」として tailnet に参加させます (127.0.0.1 で待受し、LAN内には公開されません)。設定 → 外部ツール で Tailscale (独立端末) を取得し、起動後に表示されるログイン用ページで承認してください。',
              children: (
                <>
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
                  <CheckRow
                    checked={nodeHttps}
                    onChange={setNodeHttps}
                    label="HTTPS (443) で公開する"
                    hint="Tailscale の管理画面で HTTPS 証明書の有効化が必要です。オフは HTTP (80) で、tailnet 内は WireGuard で暗号化されます。"
                  />
                  <CheckRow
                    checked={nodeEphemeral}
                    onChange={setNodeEphemeral}
                    label="一時的な端末にする"
                    hint="停止すると端末一覧から消えます。毎回ログインが必要になる場合があります。"
                  />
                </>
              )
            }
          ]}
        />
        {httpStatus.running && httpStatus.bindMode !== undefined && httpStatus.bindMode !== bindMode && (
          <StatusText kind="warn">設定変更を反映するにはサーバーを再起動してください。</StatusText>
        )}
      </div>

      <div className="mt-3">
        <CheckRow
          checked={tokenActive}
          disabled={bindMode.startsWith('tailscale')}
          onChange={setRequireToken}
          label="アクセストークンを要求する (QRコード・URLのトークンが無いと開けません)"
          hint={bindMode.startsWith('tailscale') ? 'Tailscale のモードでは常に有効です。' : undefined}
        />
        {tokenActive && (
          <Row label="トークン">
            <TextInput
              type={showToken ? 'text' : 'password'}
              readOnly
              value={token ?? ''}
              className="flex-1 min-w-0 font-mono"
            />
            <Btn onClick={() => setShowToken((v) => !v)}>{showToken ? '隠す' : '表示'}</Btn>
            <Btn onClick={() => void handleRegenerateToken()}>再生成</Btn>
          </Row>
        )}
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
