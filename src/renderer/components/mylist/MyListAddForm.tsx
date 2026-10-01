import type { RssTypeValue } from '@shared/types';
import { typeLabel, typeNameJa } from './mylistUtils';

/** 左ペイン上部: マイリスト追加フォーム + 一括更新 / アカウントから取得 ボタン */
export function MyListAddForm({
  newUrl,
  onNewUrlChange,
  newName,
  onNewNameChange,
  newType,
  urlError,
  previewLoading,
  onUrlPreview,
  onAdd,
  renewingAll,
  onRenewAll,
  accountFetching,
  onFetchAccount,
  autoDlResult,
  accountError
}: {
  newUrl: string;
  onNewUrlChange: (v: string) => void;
  newName: string;
  onNewNameChange: (v: string) => void;
  newType: RssTypeValue;
  urlError: string | null;
  previewLoading: boolean;
  onUrlPreview: () => void;
  onAdd: () => void;
  renewingAll: boolean;
  onRenewAll: () => void;
  accountFetching: boolean;
  onFetchAccount: () => void;
  autoDlResult: string | null;
  accountError: string | null;
}): JSX.Element {
  return (
    <div className="p-2 border-b border-nndd-border space-y-1 shrink-0">
      <div className="text-xs font-bold text-nndd-subtext">マイリスト追加</div>
      <input
        value={newUrl}
        onChange={(e) => onNewUrlChange(e.target.value)}
        onBlur={() => void onUrlPreview()}
        onKeyDown={(e) => { if (e.key === 'Enter') void onUrlPreview(); }}
        placeholder="URL or ID (マイリスト/チャンネル/ユーザー/シリーズ)"
        className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
      />
      <input
        value={newName}
        onChange={(e) => onNewNameChange(e.target.value)}
        placeholder="表示名 (省略可)"
        className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
      />
      {newUrl.trim() && !urlError && (
        <div className="text-xs text-nndd-subtext">
          種別: {typeLabel(newType)} {typeNameJa(newType)} {previewLoading && '(取得中…)'}
        </div>
      )}
      {urlError && (
        <div className="text-xs text-red-500 dark:text-red-400">⚠ {urlError}</div>
      )}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={onAdd}
          className="flex-1 text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
        >
          追加
        </button>
        <button
          onClick={onRenewAll}
          disabled={renewingAll}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
          title="全マイリストを更新し、未DL動画を自動でDLキューに追加"
        >
          {renewingAll ? '更新中…' : '一括更新'}
        </button>
        <button
          onClick={onFetchAccount}
          disabled={accountFetching}
          className="text-xs px-3 py-1 bg-nndd-border rounded hover:bg-nndd-accent disabled:opacity-50"
          title="ログイン中のアカウントのマイリストを取得"
        >
          {accountFetching ? '取得中…' : 'アカウントから取得'}
        </button>
      </div>
      {autoDlResult && (
        <div className="text-xs text-nndd-subtext truncate" title={autoDlResult}>
          ✓ {autoDlResult}
        </div>
      )}
      {accountError && (
        <div className="text-xs text-red-500 dark:text-red-400 truncate" title={accountError}>
          ⚠ {accountError}
        </div>
      )}
    </div>
  );
}
