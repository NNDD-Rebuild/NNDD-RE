import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';
import { LoginModal } from './LoginModal';

export function TitleBar(): JSX.Element {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const [version, setVersion] = useState<string>('');
  const [loginOpen, setLoginOpen] = useState(false);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const ok = await window.nndd.invoke<boolean>(
        window.nndd.channels.AUTH_STATUS
      );
      setLoggedIn(Boolean(ok));
    } catch {
      setLoggedIn(false);
    }
  }, [setLoggedIn]);

  useEffect(() => {
    window.nndd
      .invoke<string>(window.nndd.channels.SYS_GET_VERSION)
      .then(setVersion);
    void refreshStatus();
  }, [refreshStatus]);

  const onLogout = async (): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.AUTH_LOGOUT);
    setLoggedIn(false);
  };

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-nndd-panel border-b border-nndd-border">
      <div className="flex items-center gap-2">
        <span className="font-bold text-nndd-accent">NNDD-RE</span>
        {version && (
          <span className="text-xs text-nndd-subtext">v{version}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span
          className={isLoggedIn ? 'text-green-600 dark:text-green-400' : 'text-nndd-subtext'}
        >
          {isLoggedIn ? '● ログイン中' : '○ 未ログイン'}
        </span>
        {isLoggedIn ? (
          <button
            onClick={onLogout}
            className="px-2 py-0.5 border border-nndd-border rounded hover:bg-nndd-border"
          >
            ログアウト
          </button>
        ) : (
          <button
            onClick={() => setLoginOpen(true)}
            className="px-2 py-0.5 bg-nndd-accent text-white rounded"
          >
            ログイン
          </button>
        )}
      </div>
      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLoggedIn={() => void refreshStatus()}
        />
      )}
    </div>
  );
}
