import { useEffect, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';

interface FormLoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  mfaSubmitUrl?: string;
  error?: string;
}

interface Props {
  onClose: () => void;
  onLoggedIn: () => void;
  /** MFA-only起動時に 'mfa' を渡す */
  initialStage?: 'credentials' | 'mfa';
  /** MFA-only起動時の送信先URL */
  initialMfaSubmitUrl?: string;
}

type Stage = 'credentials' | 'mfa';

/**
 * ログインモーダル。
 * ① ID/PW フォーム入力 (アプリ内ログイン)
 * ② 2段階認証コード入力 (必要時のみ)
 * ③ 「ブラウザでログイン」も併設
 */
export function LoginModal({ onClose, onLoggedIn, initialStage, initialMfaSubmitUrl }: Props): JSX.Element {
  const showToast = useAppStore((s) => s.showToast);
  const [stage, setStage] = useState<Stage>(initialStage ?? 'credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(false);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitUrl, setMfaSubmitUrl] = useState(initialMfaSubmitUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [savedEmail, hasCreds] = await Promise.all([
        window.nndd.invoke<string | null>(window.nndd.channels.AUTH_GET_SAVED_EMAIL).catch(() => null),
        window.nndd.invoke<boolean>(window.nndd.channels.AUTH_HAS_CREDENTIALS).catch(() => false)
      ]);
      if (savedEmail) {
        setEmail(savedEmail);
        setSavePassword(true);
      }
      setHasSavedCredentials(hasCreds);
    })();
  }, []);

  const saveCredentialsIfNeeded = async (): Promise<void> => {
    if (savePassword && email && password) {
      const result = await window.nndd.invoke<{ ok: boolean; error?: string }>(
        window.nndd.channels.AUTH_SAVE_CREDENTIALS,
        { email, password }
      );
      if (!result.ok) {
        showToast(`パスワード保存失敗: ${result.error ?? '不明なエラー'}`, 5000);
      }
    }
  };

  const handleLoginResult = async (res: FormLoginResult): Promise<void> => {
    if (res.ok) {
      await saveCredentialsIfNeeded();
      onLoggedIn();
      onClose();
      return;
    }
    if (res.mfaRequired && res.mfaSubmitUrl) {
      setMfaSubmitUrl(res.mfaSubmitUrl);
      setStage('mfa');
      return;
    }
    setError(res.error ?? 'ログインに失敗しました');
  };

  const submitCredentials = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      let res: FormLoginResult;
      if (!password && hasSavedCredentials) {
        res = await window.nndd.invoke<FormLoginResult>(
          window.nndd.channels.AUTH_LOGIN_WITH_SAVED
        );
      } else {
        res = await window.nndd.invoke<FormLoginResult>(
          window.nndd.channels.AUTH_LOGIN_FORM,
          { email, password }
        );
      }
      await handleLoginResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const res = await window.nndd.invoke<FormLoginResult>(
        window.nndd.channels.AUTH_LOGIN_MFA,
        { mfaSubmitUrl, code: mfaCode }
      );
      if (res.ok) {
        await saveCredentialsIfNeeded();
        onLoggedIn();
        onClose();
        return;
      }
      setError(res.error ?? '2段階認証に失敗しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openBrowserLogin = async (): Promise<void> => {
    setBusy(true);
    try {
      const ok = await window.nndd.invoke<boolean>(
        window.nndd.channels.AUTH_OPEN_LOGIN_WINDOW
      );
      if (ok) {
        onLoggedIn();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email && (password || hasSavedCredentials) && !busy;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-nndd-panel border border-nndd-border rounded p-5 w-[360px] text-sm">
        <div className="flex justify-between items-center mb-3">
          <div className="font-bold">ニコニコ動画 ログイン</div>
          <button onClick={onClose} className="text-nndd-subtext hover:text-nndd-text">
            ×
          </button>
        </div>

        {stage === 'credentials' && (
          <>
            <label className="block mb-2">
              <span className="text-nndd-subtext">メールアドレス / 電話番号</span>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="w-full mt-1 px-2 py-1 bg-nndd-bg border border-nndd-border rounded"
                autoComplete="username"
              />
            </label>
            <label className="block mb-3">
              <span className="text-nndd-subtext">パスワード</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="w-full mt-1 px-2 py-1 bg-nndd-bg border border-nndd-border rounded"
                autoComplete="current-password"
                placeholder={hasSavedCredentials ? '●●●●●●●● (保存済み)' : ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) {
                    void submitCredentials();
                  }
                }}
              />
              {hasSavedCredentials && !password && (
                <span className="text-nndd-subtext text-xs mt-1 block">
                  空欄のまま送信すると保存済みパスワードを使用します
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={savePassword}
                onChange={(e) => setSavePassword(e.target.checked)}
                disabled={busy}
                className="accent-nndd-accent"
              />
              <span className="text-nndd-subtext">パスワードを保存して次回から自動ログイン</span>
            </label>
            {error && (
              <div className="mb-2 text-red-500 dark:text-red-400 text-xs whitespace-pre-wrap">
                {error}
              </div>
            )}
            <button
              onClick={submitCredentials}
              disabled={!canSubmit}
              className="w-full py-1.5 bg-nndd-accent text-white rounded disabled:opacity-50"
            >
              {busy ? '送信中…' : 'ログイン'}
            </button>
            <div className="my-3 text-center text-nndd-subtext text-xs">または</div>
            <button
              onClick={openBrowserLogin}
              disabled={busy}
              className="w-full py-1.5 border border-nndd-border rounded hover:bg-nndd-border disabled:opacity-50"
            >
              ブラウザでログイン
            </button>
          </>
        )}

        {stage === 'mfa' && (
          <>
            <div className="mb-3 text-nndd-subtext text-xs">
              登録された方法 (SMS / 認証アプリ等) で受け取った 6桁の認証コードを入力してください。
            </div>
            <label className="block mb-3">
              <span className="text-nndd-subtext">2段階認証コード</span>
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                disabled={busy}
                inputMode="numeric"
                maxLength={6}
                className="w-full mt-1 px-2 py-1 bg-nndd-bg border border-nndd-border rounded tracking-widest"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && mfaCode.length >= 6 && !busy) {
                    void submitMfa();
                  }
                }}
                autoFocus
              />
            </label>
            {error && (
              <div className="mb-2 text-red-500 dark:text-red-400 text-xs whitespace-pre-wrap">
                {error}
              </div>
            )}
            <button
              onClick={submitMfa}
              disabled={busy || mfaCode.length < 6}
              className="w-full py-1.5 bg-nndd-accent text-white rounded disabled:opacity-50"
            >
              {busy ? '送信中…' : '認証'}
            </button>
            <button
              onClick={() => {
                setStage('credentials');
                setMfaCode('');
                setError(null);
              }}
              disabled={busy}
              className="w-full mt-2 py-1.5 text-nndd-subtext hover:text-nndd-text disabled:opacity-50"
            >
              ← 戻る
            </button>
          </>
        )}
      </div>
    </div>
  );
}
