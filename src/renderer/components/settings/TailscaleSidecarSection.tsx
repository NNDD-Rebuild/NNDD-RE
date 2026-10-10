import { useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';

interface SidecarStatusInfo {
  supported: boolean;
  canInstall: boolean;
  installed: boolean;
  version: string | null;
  pinnedVersion: string | null;
  upToDate: boolean;
  path: string;
  hasAuthKey: boolean;
  /** 状態ディレクトリ (ログイン済みのノード鍵) がある */
  hasLogin: boolean;
  exposure: { state: string; message?: string; authUrl?: string; urls: string[] } | null;
}

const btn = 'px-3 py-1 text-xs bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-40';
const btnSub = 'px-3 py-1 text-xs bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white disabled:opacity-40';

/** 設定 > 外部ツール > Tailscale (RE 専用の独立端末)。取得・更新・削除・ログインを行う */
export function TailscaleSidecarSection(): JSX.Element {
  const [st, setSt] = useState<SidecarStatusInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [authKey, setAuthKey] = useState('');

  const refresh = (): void => {
    window.nndd.invoke<SidecarStatusInfo>(IpcChannel.TAILSCALE_STATUS).then(setSt).catch(() => {});
  };

  useEffect(() => {
    refresh();
    // ログイン承認待ち・接続状態の変化を反映する
    const timer = setInterval(refresh, 3000);
    const off = window.nndd.on(IpcChannel.BINARY_INSTALL_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as { tool: string; pct: number };
      if (data.tool === 'tailscale') setPct(Math.round(data.pct * 100));
    });
    return () => { clearInterval(timer); off(); };
  }, []);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(null); setInfo(null); setPct(0);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const install = (): Promise<void> => run(() => window.nndd.invoke(IpcChannel.TAILSCALE_INSTALL));
  const uninstall = (): Promise<void> => {
    if (!window.confirm('Tailscale サイドカーを削除します (ログイン状態は残ります)。よろしいですか？')) return Promise.resolve();
    return run(() => window.nndd.invoke(IpcChannel.TAILSCALE_UNINSTALL));
  };
  const logout = (): Promise<void> => {
    if (!window.confirm('この端末を tailnet から削除してログアウトします。再度使うにはログインし直しが必要です。よろしいですか？')) {
      return Promise.resolve();
    }
    return run(async () => {
      const r = await window.nndd.invoke<{ loggedOut: boolean }>(IpcChannel.TAILSCALE_LOGOUT);
      setInfo(
        r.loggedOut
          ? 'ログアウトしました。内蔵HTTPサーバーを再起動すると、再度ログインが必要になります。'
          : 'この端末のログイン状態を消しました。サイドカーが動いていなかったため、tailnet 側の端末は残っています。Tailscale の管理画面 (Machines) から削除してください。'
      );
    });
  };
  const saveAuthKey = (): Promise<void> =>
    run(async () => {
      await window.nndd.invoke(IpcChannel.TAILSCALE_AUTHKEY_SET, authKey);
      setAuthKey('');
    });

  const installLabel = !st?.installed ? 'ダウンロード' : st.upToDate ? '再ダウンロード' : '更新';

  return (
    <section className="bg-nndd-panel border border-nndd-border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-nndd-text">Tailscale (独立端末)</span>
        {!st ? (
          <span className="text-xs text-nndd-subtext">確認中…</span>
        ) : !st.supported ? (
          <span className="text-xs text-nndd-subtext">このOS・CPUには対応していません</span>
        ) : st.installed ? (
          <span className={`text-xs ${st.upToDate ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
            ✓ {st.version ?? '取得済み'}{st.installed && !st.upToDate && st.canInstall ? ` (更新あり: ${st.pinnedVersion})` : ''}
          </span>
        ) : (
          <span className="text-xs text-red-500 dark:text-red-400">✗ 未取得</span>
        )}
      </div>

      <p className="text-xs text-nndd-subtext">
        NNDD-RE を、PC の Tailscale とは別の「NNDD-RE 専用の端末」として tailnet に参加させます (MagicDNS 名も独自)。
        PC に Tailscale を入れていなくても使えます。閲覧する端末には Tailscale が必要です。
        使うには、設定 → 全般 → 内蔵HTTPサーバー の待受範囲で「Tailscale 独立端末」を選んで起動してください。
      </p>

      {st && st.supported && !st.canInstall && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          この NNDD-RE にはサイドカーのリリースが設定されていないため、取得できません (配布物の検証ができないものは実行しません)。
        </p>
      )}

      {busy ? (
        <div className="space-y-1">
          <div className="h-2 bg-nndd-bg rounded overflow-hidden">
            <div className="h-full bg-nndd-accent transition-all" style={{ width: pct > 0 ? `${pct}%` : '15%' }} />
          </div>
          <p className="text-xs text-nndd-subtext">{pct > 0 ? `${pct}% ` : ''}処理中…</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={!st?.supported || !st.canInstall} onClick={() => void install()}>
            {installLabel}
          </button>
          {st?.installed && (
            <button className={btnSub} onClick={() => void uninstall()}>削除</button>
          )}
          {st?.hasLogin && (
            <button className={btnSub} onClick={() => void logout()}>ログアウト (端末を削除)</button>
          )}
        </div>
      )}

      {st?.exposure && (st.exposure.state === 'needs_login' || st.exposure.state === 'error') && (
        <div className="text-xs text-yellow-600 dark:text-yellow-400">
          {st.exposure.message}
          {st.exposure.authUrl && (
            <>
              {' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.open(st.exposure?.authUrl); }}
                className="underline"
              >
                ログイン用ページを開く
              </a>
            </>
          )}
        </div>
      )}
      {st?.exposure?.state === 'running' && (
        <div className="text-xs text-green-600 dark:text-green-400">● 接続中: {st.exposure.urls.join(' ')}</div>
      )}

      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            type="password"
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder={st?.hasAuthKey ? 'Auth key 設定済み (変更する場合のみ入力)' : 'Auth key (任意。ブラウザで承認する場合は不要)'}
            className="flex-1 bg-nndd-bg border border-nndd-border rounded px-2 py-1 text-xs text-nndd-text placeholder-nndd-subtext focus:outline-none focus:border-nndd-accent"
          />
          <button className={btnSub} disabled={busy || (!authKey.trim() && !st?.hasAuthKey)} onClick={() => void saveAuthKey()}>
            {authKey.trim() ? '保存' : '削除'}
          </button>
        </div>
        <p className="text-xs text-nndd-subtext">
          Tailscale の管理画面で作った使い捨て (one-off)・期限付きの Auth key を推奨します。ログインできた時点で破棄します。
          Auth key を使わない場合は、起動後に表示されるログイン用ページで承認します。
        </p>
      </div>

      {info && <p className="text-xs text-nndd-subtext">{info}</p>}
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </section>
  );
}
