import type { RssTypeValue } from '@shared/types';
import { typeLabel, typeNameJa } from './mylistUtils';

/** 追加フォームで作れるもの (プルダウンで切り替える) */
export type AddKind = 'mylist' | 'playlist' | 'folder';

const ADD_KIND_OPTIONS: { value: AddKind; label: string }[] = [
  { value: 'mylist', label: 'マイリスト' },
  { value: 'playlist', label: 'プレイリスト' },
  { value: 'folder', label: 'フォルダ' }
];

/**
 * 左ペイン上部の追加フォーム。プルダウンで マイリスト (URL/ID を登録) / プレイリスト / フォルダ (名前で新規作成) を切り替える。
 * マイリストのときだけ 一括更新 / アカウントから取得 ボタンを出す。
 */
export function MyListAddForm({
  kind,
  onKindChange,
  createName,
  onCreateNameChange,
  createSync,
  onCreateSyncChange,
  isLoggedIn,
  onCreate,
  createPending,
  createPublic,
  onCreatePublicChange,
  creating,
  onConfirmCreate,
  onCancelCreate,
  newUrl,
  onNewUrlChange,
  newName,
  onNewNameChange,
  newType,
  urlError,
  previewLoading,
  urlHistory,
  onUrlPreview,
  onAdd,
  renewingAll,
  onRenewAll,
  accountFetching,
  onFetchAccount,
  autoDlResult,
  accountError
}: {
  kind: AddKind;
  onKindChange: (k: AddKind) => void;
  /** プレイリスト・フォルダの新規作成名 */
  createName: string;
  onCreateNameChange: (v: string) => void;
  /** プレイリスト作成時にニコニコにも非公開マイリストを作って同期するか */
  createSync: boolean;
  onCreateSyncChange: (v: boolean) => void;
  isLoggedIn: boolean;
  onCreate: () => void;
  /** URL なしで表示名だけ入れて追加したとき、新規作成の確認を出す */
  createPending: boolean;
  createPublic: boolean;
  onCreatePublicChange: (v: boolean) => void;
  creating: boolean;
  onConfirmCreate: () => void;
  onCancelCreate: () => void;
  newUrl: string;
  onNewUrlChange: (v: string) => void;
  newName: string;
  onNewNameChange: (v: string) => void;
  newType: RssTypeValue;
  urlError: string | null;
  previewLoading: boolean;
  urlHistory: { name: string; url: string }[];
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
      <div className="flex items-center gap-1">
        <select
          value={kind}
          onChange={(e) => onKindChange(e.target.value as AddKind)}
          className="bg-nndd-bg border border-nndd-border px-1 py-1 text-xs font-bold"
          title="追加するものを選択"
        >
          {ADD_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-xs font-bold text-nndd-subtext">を追加</span>
      </div>
      {kind !== 'mylist' && (
        <>
          <div className="flex gap-1">
            <input
              value={createName}
              onChange={(e) => onCreateNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCreate(); }}
              placeholder={kind === 'playlist' ? '新しいプレイリスト名' : '新しいフォルダ名'}
              className="flex-1 min-w-0 bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
            />
            <button
              onClick={onCreate}
              className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            >
              作成
            </button>
          </div>
          {kind === 'playlist' && isLoggedIn && (
            <label
              className="flex items-center gap-1 text-xs cursor-pointer select-none"
              title="ON にすると、同名の非公開マイリストをニコニコにも作成し、動画の追加・削除を同期します"
            >
              <input
                type="checkbox"
                checked={createSync}
                onChange={(e) => onCreateSyncChange(e.target.checked)}
              />
              ニコニコと同期する
            </label>
          )}
        </>
      )}
      {kind === 'mylist' && (<>
      <input
        value={newUrl}
        list="nndd-mylist-history"
        onChange={(e) => onNewUrlChange(e.target.value)}
        onBlur={() => void onUrlPreview()}
        onKeyDown={(e) => { if (e.key === 'Enter') void onUrlPreview(); }}
        placeholder="URL or ID (マイリスト/チャンネル/ユーザー/シリーズ)"
        className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
      />
      <datalist id="nndd-mylist-history">
        {urlHistory.map((h) => <option key={h.url} value={h.url} label={h.name} />)}
      </datalist>
      <input
        value={newName}
        onChange={(e) => onNewNameChange(e.target.value)}
        placeholder="表示名 (URL なしで追加すると新規作成)"
        className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-xs"
      />
      {createPending && (
        <div className="border border-nndd-accent rounded p-2 space-y-1 bg-nndd-bg">
          <div className="text-xs">
            「{newName.trim()}」を新しいマイリストとして、ニコニコのアカウントに作成しますか?
          </div>
          <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
            <input type="radio" checked={!createPublic} onChange={() => onCreatePublicChange(false)} />
            非公開 (自分だけ見られる)
          </label>
          <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
            <input type="radio" checked={createPublic} onChange={() => onCreatePublicChange(true)} />
            公開 (誰でも見られる)
          </label>
          <div className="flex gap-1">
            <button
              onClick={onConfirmCreate}
              disabled={creating}
              className="flex-1 text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
            >
              {creating ? '作成中…' : '作成'}
            </button>
            <button
              onClick={onCancelCreate}
              disabled={creating}
              className="text-xs px-3 py-1 bg-nndd-border rounded hover:opacity-80 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
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
          title="全マイリストを再取得して更新"
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
      </>)}
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
