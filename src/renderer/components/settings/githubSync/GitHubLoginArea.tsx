import type { GitHubStatus } from '@shared/types';

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
        <button
          onClick={onLogout}
          className="text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded"
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onLogin}
        disabled={loading}
        className="text-xs px-3 py-1.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
      >
        {loading ? '接続中…' : 'GitHubでログイン'}
      </button>
      <span className="text-xs text-nndd-subtext">
        Device Flow でブラウザ経由の認可を行います
      </span>
    </div>
  );
}
