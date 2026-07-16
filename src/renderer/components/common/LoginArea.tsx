import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';
import type { AutoReloginResult } from '@shared/types';
import { LoginModal } from './LoginModal';

interface SessionExpiredPayload {
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
}

export function LoginArea(): JSX.Element {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const showToast = useAppStore((s) => s.showToast);
  const [loginOpen, setLoginOpen] = useState(false);
  const [autoMfaOpen, setAutoMfaOpen] = useState(false);
  const [autoMfaUrl, setAutoMfaUrl] = useState('');

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const ok = await window.nndd.invoke<boolean>(window.nndd.channels.AUTH_STATUS);
      setLoggedIn(Boolean(ok));
    } catch {
      setLoggedIn(false);
    }
  }, [setLoggedIn]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogout = async (): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.AUTH_LOGOUT);
    setLoggedIn(false);
  };

  return (
    <div className="ml-auto flex items-center gap-3 px-3 text-xs">
      <span className={isLoggedIn ? 'text-green-600 dark:text-green-400' : 'text-nndd-subtext'}>
        {isLoggedIn ? '● ログイン中' : '○ 未ログイン'}
      </span>
      {isLoggedIn ? (
        <>
          <button
            onClick={onLogout}
            className="px-2 py-0.5 border border-nndd-border rounded hover:bg-nndd-border"
          >
            ログアウト
          </button>
        </>
      ) : (
        <button
          onClick={() => setLoginOpen(true)}
          className="px-2 py-0.5 bg-nndd-accent text-white rounded"
        >
          ログイン
        </button>
      )}
      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLoggedIn={() => {
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
