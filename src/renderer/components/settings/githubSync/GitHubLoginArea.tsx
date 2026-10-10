import type { GitHubStatus } from '@shared/types';
import { Btn, Hint } from '../common';

export function GitHubLoginArea({
  status,
  loading,
  onLogin,
  onLogout
}: {
  status: GitHubStatus;
  loading: boolean;
  onLogin: () => void;
  onLogout: () => void;
}): JSX.Element {
  if (status.loggedIn) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-nndd-text">
          GitHub: <span className="font-bold">{status.username}</span> でログイン中
        </span>
        <Btn onClick={onLogout}>ログアウト</Btn>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Btn variant="primary" onClick={onLogin} disabled={loading}>
        {loading ? '接続中…' : 'GitHubでログイン'}
      </Btn>
      <Hint>Device Flow でブラウザ経由の認可を行います</Hint>
    </div>
  );
}
