import { useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';
import { Btn, Card, Hint, StatusText, TextInput } from './common';

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
    return () => {
      clearInterval(timer);
      off();
    };
  }, []);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    setPct(0);
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
  const exposure = st?.exposure;

  return (
    <Card
      title="Tailscale (独立端末)"
      right={
        !st ? (
          <Hint>確認中…</Hint>
        ) : !st.supported ? (
          <Hint>このOS・CPUには対応していません</Hint>
        ) : st.installed ? (
          <StatusText kind={st.upToDate ? 'ok' : 'warn'}>
            ✓ {st.version ?? '取得済み'}
            {!st.upToDate && st.canInstall ? ` (更新あり: ${st.pinnedVersion})` : ''}
          </StatusText>
        ) : (
          <StatusText kind="error">✗ 未取得</StatusText>
        )
      }
    >
      <Hint>
        NNDD-RE を、PC の Tailscale とは別の「NNDD-RE 専用の端末」として tailnet に参加させます (MagicDNS 名も独自)。
        PC に Tailscale を入れていなくても使えます。閲覧する端末には Tailscale が必要です。
        使うには、設定 → 全般 → 内蔵HTTPサーバー の待受範囲で「Tailscale 独立端末」を選んで起動してください。
      </Hint>

      {st && st.supported && !st.canInstall && (
        <StatusText kind="warn">
          この NNDD-RE にはサイドカーのリリースが設定されていないため、取得できません (配布物の検証ができないものは実行しません)。
        </StatusText>
      )}

      {busy ? (
        <div className="space-y-1">
          <div className="h-2 bg-nndd-bg rounded overflow-hidden">
            <div className="h-full bg-nndd-accent transition-all" style={{ width: pct > 0 ? `${pct}%` : '15%' }} />
          </div>
          <Hint>{pct > 0 ? `${pct}% ` : ''}処理中…</Hint>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!st?.supported || !st.canInstall} onClick={() => void install()}>
            {installLabel}
          </Btn>
          {st?.installed && <Btn onClick={() => void uninstall()}>削除</Btn>}
          {st?.hasLogin && <Btn variant="danger" onClick={() => void logout()}>ログアウト (端末を削除)</Btn>}
        </div>
      )}

      {exposure && (exposure.state === 'needs_login' || exposure.state === 'error') && (
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
      {exposure?.state === 'running' && <StatusText kind="ok">● 接続中: {exposure.urls.join(' ')}</StatusText>}

      <div className="space-y-1">
        <div className="flex gap-2">
          <TextInput
            type="password"
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder={st?.hasAuthKey ? 'Auth key 設定済み (変更する場合のみ入力)' : 'Auth key (任意。ブラウザで承認する場合は不要)'}
            className="flex-1"
          />
          <Btn disabled={busy || (!authKey.trim() && !st?.hasAuthKey)} onClick={() => void saveAuthKey()}>
            {authKey.trim() ? '保存' : '削除'}
          </Btn>
        </div>
        <Hint>
          Tailscale の管理画面で作った使い捨て (one-off)・期限付きの Auth key を推奨します。ログインできた時点で破棄します。
          Auth key を使わない場合は、起動後に表示されるログイン用ページで承認します。
          アクセスできる端末を絞るには、管理画面で Auth key にタグ (例: tag:nndd-re) を付けて作成し、ACL で
          {"{ \"action\": \"accept\", \"src\": [\"autogroup:member\"], \"dst\": [\"tag:nndd-re:80\"] }"} のように許可します。
        </Hint>
      </div>

      {info && <Hint>{info}</Hint>}
      {error && <StatusText kind="error">{error}</StatusText>}
    </Card>
  );
}
