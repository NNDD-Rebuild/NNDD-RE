import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';
import type { AccountsState, AutoReloginResult, NicoAccount } from '@shared/types';
import { LoginModal } from './LoginModal';

interface SessionExpiredPayload {
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
}

interface SwitchResult {
  ok: boolean;
  needLogin?: boolean;
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
  error?: string;
}

/** ニコニコ本家風のアイコン。プレミアム会員は黄色のリングで囲む */
function AccountAvatar({ account, size }: { account: NicoAccount; size: number }): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.iconUrl]);
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden bg-nndd-border',
        account.isPremium ? 'ring-2 ring-yellow-400' : 'ring-1 ring-nndd-border'
      ].join(' ')}
      style={{ width: size, height: size }}
    >
      {account.iconUrl && !failed ? (
        <img
          src={account.iconUrl}
          alt=""
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-nndd-subtext" style={{ fontSize: size * 0.5 }}>
          {account.nickname.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

function nameClass(account: NicoAccount): string {
  return account.isPremium ? 'text-yellow-500 dark:text-yellow-400 font-bold' : 'text-nndd-text';
}

export function LoginArea(): JSX.Element {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const accountsState = useAppStore((s) => s.accounts);
  const setAccounts = useAppStore((s) => s.setAccounts);
  const showToast = useAppStore((s) => s.showToast);
  const [loginOpen, setLoginOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [autoMfaOpen, setAutoMfaOpen] = useState(false);
  const [autoMfaUrl, setAutoMfaUrl] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const active = accountsState.accounts.find((a) => a.id === accountsState.activeId) ?? null;

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const ok = await window.nndd.invoke<boolean>(window.nndd.channels.AUTH_STATUS);
      setLoggedIn(Boolean(ok));
    } catch {
      setLoggedIn(false);
    }
  }, [setLoggedIn]);

  // アカウント一覧の取得 + main 側の変化通知 (ログイン/切替/プロフィール更新/移行)
  useEffect(() => {
    void window.nndd
      .invoke<AccountsState>(window.nndd.channels.ACCOUNT_LIST)
      .then(setAccounts)
      .catch(() => undefined);
    return window.nndd.on(window.nndd.channels.ACCOUNT_CHANGED, (payload: unknown) => {
      setAccounts(payload as AccountsState);
    });
  }, [setAccounts]);

  // 起動時: セッション確認 + 期限切れなら自動再ログイン
  useEffect(() => {
    void (async () => {
      try {
        const result = await window.nndd.invoke<AutoReloginResult>(
          window.nndd.channels.AUTH_AUTO_RELOGIN
        );
        if (result.ok) {
          setLoggedIn(true);
        } else if (result.mfaRequired && result.mfaSubmitUrl) {
          setAutoMfaUrl(result.mfaSubmitUrl);
          setAutoMfaOpen(true);
        } else {
          setLoggedIn(false);
        }
      } catch {
        setLoggedIn(false);
      }
    })();
  }, [setLoggedIn]);

  // セッション切れ通知 (定期チェックで main から送信)
  useEffect(() => {
    const unsub = window.nndd.on(
      window.nndd.channels.AUTH_SESSION_EXPIRED,
      (payload: unknown) => {
        const { mfaRequired, mfaSubmitUrl } = (payload ?? {}) as SessionExpiredPayload;
        setLoggedIn(false);
        showToast('セッションが切れました。再ログインしてください。', 5000);
        if (mfaRequired && mfaSubmitUrl) {
          setAutoMfaUrl(mfaSubmitUrl);
          setAutoMfaOpen(true);
        } else {
          setLoginOpen(true);
        }
      }
    );
    return unsub;
  }, [setLoggedIn, showToast]);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const onLogout = async (): Promise<void> => {
    setMenuOpen(false);
    await window.nndd.invoke(window.nndd.channels.AUTH_LOGOUT);
    setLoggedIn(false);
  };

  const onSwitch = async (id: string): Promise<void> => {
    setMenuOpen(false);
    if (switching || (id === accountsState.activeId && isLoggedIn)) return;
    setSwitching(true);
    // 一度未ログインにして、ログイン状態に依存するビュー (フォロー/マイリスト等) に再取得させる
    setLoggedIn(false);
    try {
      const res = await window.nndd.invoke<SwitchResult>(window.nndd.channels.ACCOUNT_SWITCH, {
        id
      });
      if (res.ok) {
        setLoggedIn(true);
        return;
      }
      if (res.mfaRequired && res.mfaSubmitUrl) {
        setAutoMfaUrl(res.mfaSubmitUrl);
        setAutoMfaOpen(true);
      } else if (res.needLogin) {
        if (res.error) showToast(res.error, 5000);
        setLoginOpen(true);
      } else {
        showToast(res.error ?? 'アカウントの切り替えに失敗しました', 5000);
      }
    } catch (e) {
      showToast(`アカウントの切り替えに失敗しました: ${e instanceof Error ? e.message : String(e)}`, 5000);
    } finally {
      setSwitching(false);
    }
  };

  const onRemove = async (account: NicoAccount): Promise<void> => {
    if (!window.confirm(`${account.nickname} をこのアプリから削除します。\n保存済みのログイン情報も消去されます。`)) {
      return;
    }
    const wasActive = account.id === accountsState.activeId;
    await window.nndd.invoke(window.nndd.channels.ACCOUNT_REMOVE, { id: account.id });
    if (wasActive) setLoggedIn(false);
  };

  const others = accountsState.accounts.filter((a) => a.id !== accountsState.activeId);

  return (
    <div ref={menuRef} className="ml-auto relative flex items-center gap-3 px-3 text-xs">
      {isLoggedIn && active ? (
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-nndd-border"
          title="アカウントメニュー"
        >
          <AccountAvatar account={active} size={24} />
          <span className={`max-w-[160px] truncate ${nameClass(active)}`}>{active.nickname}</span>
          <span className="text-nndd-subtext">▾</span>
        </button>
      ) : isLoggedIn ? (
        // アカウント情報の取得前/失敗時 (旧セッションの移行待ち等)
        <>
          <span className="text-green-600 dark:text-green-400">● ログイン中</span>
          <button
            onClick={onLogout}
            className="px-2 py-0.5 border border-nndd-border rounded hover:bg-nndd-border"
          >
            ログアウト
          </button>
        </>
      ) : (
        <>
          <span className="text-nndd-subtext">○ 未ログイン</span>
          <button
            onClick={() => setLoginOpen(true)}
            disabled={switching}
            className="px-2 py-0.5 bg-nndd-accent text-white rounded disabled:opacity-50"
          >
            {switching ? '切替中…' : 'ログイン'}
          </button>
          {accountsState.accounts.length > 0 && (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="px-1.5 py-0.5 border border-nndd-border rounded hover:bg-nndd-border"
              title="登録済みアカウント"
            >
              ▾
            </button>
          )}
        </>
      )}

      {menuOpen && (
        <div className="absolute right-3 top-full mt-1 z-40 w-64 bg-nndd-panel border border-nndd-border rounded shadow-lg py-1">
          {isLoggedIn && active && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-nndd-border">
              <AccountAvatar account={active} size={32} />
              <div className="min-w-0">
                <div className={`truncate ${nameClass(active)}`}>{active.nickname}</div>
                <div className="text-nndd-subtext">
                  {active.isPremium ? 'プレミアム会員' : '一般会員'} / ID: {active.id}
                </div>
              </div>
            </div>
          )}
          {(isLoggedIn ? others : accountsState.accounts).map((a) => (
            <div key={a.id} className="group flex items-center hover:bg-nndd-border">
              <button
                onClick={() => void onSwitch(a.id)}
                className="flex flex-1 min-w-0 items-center gap-2 px-3 py-1.5 text-left"
              >
                <AccountAvatar account={a} size={24} />
                <span className={`truncate ${nameClass(a)}`}>{a.nickname}</span>
              </button>
              <button
                onClick={() => void onRemove(a)}
                className="px-2 text-nndd-subtext hover:text-red-500 opacity-0 group-hover:opacity-100"
                title="このアカウントを削除"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              setAddOpen(true);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-nndd-border"
          >
            ＋ アカウントを追加
          </button>
          {isLoggedIn && (
            <button
              onClick={onLogout}
              className="w-full px-3 py-1.5 text-left hover:bg-nndd-border border-t border-nndd-border"
            >
              ログアウト
            </button>
          )}
        </div>
      )}

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLoggedIn={() => {
            void refreshStatus();
          }}
        />
      )}
      {addOpen && (
        <LoginModal
          addAccount
          onClose={() => setAddOpen(false)}
          onLoggedIn={() => {
            // 新アカウントがアクティブになっている。ビューに再取得させるため一度未ログインを挟む
            setLoggedIn(false);
            void refreshStatus();
          }}
        />
      )}
      {autoMfaOpen && (
        <LoginModal
          initialStage="mfa"
          initialMfaSubmitUrl={autoMfaUrl}
          onClose={() => setAutoMfaOpen(false)}
          onLoggedIn={() => {
            void refreshStatus();
          }}
        />
      )}
    </div>
  );
}
