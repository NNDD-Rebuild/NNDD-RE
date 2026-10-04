import { useEffect, useState } from 'react';
import { LoginModal } from '../../common/LoginModal';
import { useAppStore } from '@renderer/store/useAppStore';
import { Section, Btn } from '../common';

/** 設定 > 全般 > ニコニコ動画 ログイン (メール/ブラウザ ログイン、ログアウト、保存済み ID・PASS の削除) */
export function LoginSection(): JSX.Element {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const [authBusy, setAuthBusy] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);

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

  useEffect(() => {
    refreshLoginStatus();
    refreshHasCredentials();
  }, []);

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

  return (
    <>
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
    </>
  );
}
