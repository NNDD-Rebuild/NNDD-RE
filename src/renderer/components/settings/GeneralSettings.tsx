import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { IpcChannel } from '@shared/types';
import { LoginModal } from '../common/LoginModal';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';


/**
 * 設定 > 全般。
 * 元: NNDD.mxml の Canvas label="全般"
 *
 *  - 動画の保存先
 *  - ログイン
 *  - HTTPサーバー起動/停止
 *  - ウィンドウ位置リセット
 */
interface CacheInfo { sizeBytes: number; fileCount: number; dir: string }

interface GeneralSettingsProps {
  onDeveloperModeChange?: (enabled: boolean) => void;
}

export function GeneralSettings({ onDeveloperModeChange }: GeneralSettingsProps): JSX.Element {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const [libraryRoot, setLibraryRoot] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
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

  // LANライブラリ (リモートNNDD)
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteAddress, setRemoteAddress] = useState('');
  const [remotePort, setRemotePort] = useState(12300);

  // 画像キャッシュ
  const [imgCacheEnabled, setImgCacheEnabled] = useState(true);
  const [imgCacheMaxSizeMb, setImgCacheMaxSizeMb] = useState(1000);
  const [imgCacheInfo, setImgCacheInfo] = useState<CacheInfo | null>(null);
  const [imgCacheBusy, setImgCacheBusy] = useState(false);

  // 開発者オプション
  const [developerEnabled, setDeveloperEnabled] = useState(false);

  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);

  const refreshImgCacheInfo = (): void => {
    window.nndd
      .invoke<CacheInfo>(IpcChannel.IMAGE_CACHE_INFO)
      .then(setImgCacheInfo)
      .catch(() => {});
  };

  useEffect(() => {
    window.nndd
      .invoke<string>(window.nndd.channels.CONFIG_GET, 'libraryRoot')
      .then((v) => setLibraryRoot(v ?? ''));
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'imageCache.enabled')
      .then((v) => setImgCacheEnabled(v !== false))
      .catch(() => {});
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'imageCache.maxSizeMb')
      .then((v) => { if (typeof v === 'number') setImgCacheMaxSizeMb(v); })
      .catch(() => {});
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'developer.enabled')
      .then((v) => setDeveloperEnabled(v !== false))
      .catch(() => {});
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
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'remoteNndd.enabled')
      .then((v) => setRemoteEnabled(v === true))
      .catch(() => {});
    window.nndd
      .invoke<string>(window.nndd.channels.CONFIG_GET, 'remoteNndd.address')
      .then((v) => setRemoteAddress(v ?? ''))
      .catch(() => {});
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'remoteNndd.port')
      .then((v) => { if (typeof v === 'number') setRemotePort(v); })
      .catch(() => {});
    refreshImgCacheInfo();
    refreshLoginStatus();
    refreshHasCredentials();
    refreshHttpStatus();
  }, []);

  const refreshLoginStatus = (): void => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.AUTH_STATUS)
      .then(setLoggedIn)
      .catch(() => setLoggedIn(false));
  };

  const refreshHasCredentials = (): void => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.AUTH_HAS_CREDENTIALS)
      .then(setHasSavedCredentials)
      .catch(() => setHasSavedCredentials(false));
  };

  const refreshHttpStatus = (): void => {
    window.nndd
      .invoke<{ running: boolean; port?: number; lanIp?: string }>(
        window.nndd.channels.HTTPD_STATUS
      )
      .then(setHttpStatus)
      .catch(() => setHttpStatus({ running: false }));
  };

  const chooseDir = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      window.nndd.channels.SYS_CHOOSE_DIRECTORY,
      libraryRoot
    );
    if (dir) {
      setLibraryRoot(dir);
      await window.nndd.invoke(
        window.nndd.channels.CONFIG_SET,
        'libraryRoot',
        dir
      );
    }
  };

  const openLibrary = async (): Promise<void> => {
    if (libraryRoot) {
      await window.nndd.invoke(
        window.nndd.channels.SYS_OPEN_PATH,
        libraryRoot
      );
    }
  };

  const resetToDefault = async (): Promise<void> => {
    setLibraryRoot('');
    await window.nndd.invoke(
      window.nndd.channels.CONFIG_SET,
      'libraryRoot',
      ''
    );
  };

  const handleLogin = async (): Promise<void> => {
    setAuthBusy(true);
    try {
      await window.nndd.invoke(window.nndd.channels.AUTH_OPEN_LOGIN_WINDOW);
      refreshLoginStatus();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setAuthBusy(true);
    try {
      await window.nndd.invoke(window.nndd.channels.AUTH_LOGOUT);
      refreshLoginStatus();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleClearCredentials = async (): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.AUTH_CLEAR_CREDENTIALS);
    setHasSavedCredentials(false);
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

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">全般</h2>

      <Section title="動画の保存先">
        <div className="flex items-center gap-2">
          <input
            value={libraryRoot}
            readOnly
            className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
            placeholder="(デフォルト: Documents/NNDD-RE/library/Downloads)"
          />
          <Btn onClick={chooseDir}>参照...</Btn>
          <Btn onClick={openLibrary} disabled={!libraryRoot}>
            開く
          </Btn>
          <Btn onClick={resetToDefault} disabled={!libraryRoot}>
            デフォルトに戻す
          </Btn>
        </div>
      </Section>

      <Section title="ニコニコ動画 ログイン">
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm">
            {isLoggedIn ? (
              <span className="text-green-600 dark:text-green-400">● ログイン中</span>
            ) : (
              <span className="text-nndd-subtext">○ 未ログイン</span>
            )}
          </div>
          {!isLoggedIn && (
            <>
              <Btn
                onClick={() => setShowLoginModal(true)}
                disabled={authBusy}
              >
                メールでログイン
              </Btn>
              <Btn onClick={handleLogin} disabled={authBusy}>
                {authBusy ? '処理中…' : 'ブラウザでログイン'}
              </Btn>
            </>
          )}
          {isLoggedIn && (
            <>
              <Btn onClick={handleLogout} disabled={authBusy}>
                {authBusy ? '処理中…' : 'ログアウト'}
              </Btn>
              {hasSavedCredentials && (
                <Btn onClick={handleClearCredentials} disabled={authBusy}>
                  ID・PASS削除
                </Btn>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-nndd-subtext mt-2">
          「メールでログイン」はアプリ内でメール+パスワード+2段階認証コードを入力します。
          「ブラウザでログイン」は別ウィンドウで公式ログインページを開きます。
          「パスワードを保存」をチェックすると次回から自動ログインします。
        </p>
      </Section>
      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLoggedIn={refreshLoginStatus}
        />
      )}

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
                        value={`${httpStatus.lanIp ?? 'localhost'}:${httpStatus.port}`}
                        size={128}
                      />
                    </div>
                  )}
                  {showQr && (
                    <p className="text-xs text-nndd-subtext mt-1">
                      {httpStatus.lanIp
                        ? `${httpStatus.lanIp}:${httpStatus.port}`
                        : `localhost:${httpStatus.port}`}
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

      <Section title="LANライブラリ (リモートNNDD参照)">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={remoteEnabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setRemoteEnabled(v);
              await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.enabled', v);
            }}
          />
          リモートNNDDのライブラリを参照する
        </label>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-nndd-subtext w-24 shrink-0">IPアドレス</span>
          <input
            type="text"
            placeholder="192.168.x.x"
            value={remoteAddress}
            onChange={(e) => setRemoteAddress(e.target.value)}
            onBlur={async () => {
              await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.address', remoteAddress);
            }}
            className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-nndd-subtext w-24 shrink-0">ポート</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={remotePort}
            onChange={(e) => setRemotePort(Number(e.target.value))}
            onBlur={async () => {
              await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.port', remotePort);
            }}
            className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext">(本家NNDDデフォルト: 12300)</span>
        </div>
        <p className="text-xs text-nndd-subtext mt-2">
          同じLAN内の本家NNDDまたはNNDD-REのライブラリを「LANライブラリ」タブで閲覧・再生できます。
          本家NNDDではサーバー設定でポート12300・動画情報共有を有効にしてください。
        </p>
      </Section>

      <Section title="ウィンドウの大きさ・位置をリセットする">
        <Btn
          onClick={async () => {
            await window.nndd.invoke(
              window.nndd.channels.CONFIG_SET,
              'ui.window',
              { width: 1280, height: 800, maximized: false }
            );
          }}
        >
          リセット
        </Btn>
      </Section>

      <Section title="画像キャッシュ (サムネイル・アイコン)">
        <div className="flex items-center gap-3 mb-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={imgCacheEnabled}
              onChange={async (e) => {
                const v = e.target.checked;
                setImgCacheEnabled(v);
                await window.nndd.invoke(IpcChannel.IMAGE_CACHE_ENABLED_SET, v);
              }}
            />
            キャッシュを有効にする
          </label>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-nndd-subtext w-20 shrink-0">上限サイズ</span>
          <input
            type="number"
            min={0}
            step={100}
            value={imgCacheMaxSizeMb}
            onChange={async (e) => {
              const v = Math.max(0, Number(e.target.value));
              setImgCacheMaxSizeMb(v);
              await window.nndd.invoke(IpcChannel.IMAGE_CACHE_MAX_SIZE_SET, v);
            }}
            className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext">MB (0 = 無制限)</span>
        </div>
        {imgCacheInfo && (
          <div className="text-xs text-nndd-subtext mb-2">
            {imgCacheInfo.fileCount} ファイル /{' '}
            {(imgCacheInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB
            <span className="ml-2 opacity-60 truncate" title={imgCacheInfo.dir}>
              ({imgCacheInfo.dir})
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <Btn onClick={refreshImgCacheInfo}>更新</Btn>
          <Btn
            disabled={imgCacheBusy}
            onClick={async () => {
              if (!confirm('画像キャッシュをすべて削除しますか？')) return;
              setImgCacheBusy(true);
              try {
                await window.nndd.invoke(IpcChannel.IMAGE_CACHE_CLEAR);
                refreshImgCacheInfo();
              } finally {
                setImgCacheBusy(false);
              }
            }}
          >
            {imgCacheBusy ? '削除中…' : 'キャッシュを削除'}
          </Btn>
        </div>
        <p className="text-xs text-nndd-subtext mt-2">
          動画再生時に取得したサムネイルとユーザーアイコンをローカルに保存します。
          次回同じ動画を開く際にオフラインでも表示できます。
        </p>
      </Section>

      <Section title="開発者オプション">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={developerEnabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setDeveloperEnabled(v);
              await window.nndd.invoke(
                window.nndd.channels.CONFIG_SET,
                'developer.enabled',
                v
              );
              onDeveloperModeChange?.(v);
            }}
          />
          <span className="font-bold">開発者モードを有効にする</span>
        </label>
        <p className="text-xs text-nndd-subtext mt-2">
          有効にすると、設定画面に「デバッグ」タブが表示され、
          API生データの保存先選択やダンプ対象の設定ができるようになります。
        </p>
      </Section>

      <Section title="バージョン">
        <div className="text-sm text-nndd-subtext">
          NNDD-RE (Adobe AIR 版から移植)
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
