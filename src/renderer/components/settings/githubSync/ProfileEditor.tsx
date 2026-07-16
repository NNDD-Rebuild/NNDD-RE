import { useState } from 'react';
import type { DataScope, GistSummary, SyncProfile } from '@shared/types';

const SCOPE_LABELS: { key: keyof DataScope; label: string }[] = [
  { key: 'config', label: 'アプリ設定 (プレイヤー・UI・LAN共有等)' },
  { key: 'ngList', label: 'NGリスト (コメント/タグ/ユーザー)' },
  { key: 'myList', label: 'マイリスト登録一覧' },
  { key: 'schedule', label: 'スケジュール (予約DL)' },
  { key: 'savedSearch', label: '保存検索' },
  { key: 'playlist', label: '自作プレイリスト' },
  { key: 'history', label: '視聴履歴 (データ量が多いため既定OFF)' }
];

export function ProfileEditor({
  profile,
  onChangeScope,
  onToggleAutoUpload,
  onUpload,
  onDownload,
  onLinkGist,
  uploading,
  downloading,
  resultMessage
}: {
  profile: SyncProfile;
  onChangeScope: (scope: DataScope) => void;
  onToggleAutoUpload: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onLinkGist: (gistId: string) => void;
  uploading: boolean;
  downloading: boolean;
  resultMessage: string | null;
}): JSX.Element {
  const [candidates, setCandidates] = useState<GistSummary[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const toggleScope = (key: keyof DataScope): void => {
    onChangeScope({ ...profile.dataScope, [key]: !profile.dataScope[key] });
  };

  const handleShowCandidates = async (): Promise<void> => {
    setLoadingCandidates(true);
    try {
      const list = await window.nndd.invoke<GistSummary[]>(
        window.nndd.channels.BACKUP_LIST_CANDIDATE_GISTS
      );
      setCandidates(list ?? []);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleDownload = (): void => {
    if (
      !window.confirm(
        'ローカルのデータは選択中の同期対象について、Gistの内容で全て置き換えられます。よろしいですか?'
      )
    ) {
      return;
    }
    onDownload();
  };

  return (
    <div className="space-y-4 border border-nndd-border rounded p-4">
      <div className="text-sm font-bold text-nndd-text">{profile.name}</div>

      <div>
        <div className="text-xs text-nndd-subtext mb-2">同期対象データ</div>
        <div className="space-y-1">
          {SCOPE_LABELS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-xs text-nndd-text">
              <input
                type="checkbox"
                checked={!!profile.dataScope[s.key]}
                onChange={() => toggleScope(s.key)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs text-nndd-text">
          <input
            type="checkbox"
            checked={!!profile.autoUploadEnabled}
            onChange={onToggleAutoUpload}
          />
          アプリ起動時・終了時に自動アップロード
        </label>
        <p className="text-[11px] text-nndd-subtext mt-1">
          このプロファイルがアクティブな間のみ有効です。前回アップロード時から変更がない場合はスキップされます。
          ダウンロードは自動実行されません(手動のみ)。
        </p>
      </div>

      <div>
        <div className="text-xs text-nndd-subtext mb-2">Gist連携</div>
        {profile.gistId ? (
          <div className="text-xs text-nndd-text">連携済み (Gist ID: {profile.gistId})</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-nndd-subtext">
              未連携です。「アップロード」を実行すると新規Gistが自動作成されます。
              既存のGistに連携する場合は下から選択してください。
            </div>
            <button
              onClick={handleShowCandidates}
              disabled={loadingCandidates}
              className="text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded disabled:opacity-50"
            >
              {loadingCandidates ? '検索中…' : '既存Gistを検索'}
            </button>
            {candidates && (
              <div className="border border-nndd-border rounded divide-y divide-nndd-border max-h-40 overflow-y-auto">
                {candidates.length === 0 ? (
                  <div className="text-xs text-nndd-subtext italic px-2 py-1.5">
                    候補が見つかりませんでした
                  </div>
                ) : (
                  candidates.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-nndd-border/30"
                    >
                      <span className="text-nndd-text truncate">{g.description}</span>
                      <button
                        onClick={() => onLinkGist(g.id)}
                        className="shrink-0 ml-2 text-nndd-accent hover:underline"
                      >
                        連携
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onUpload}
          disabled={uploading || downloading}
          className="text-xs px-3 py-1.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
        >
          {uploading ? 'アップロード中…' : 'アップロード'}
        </button>
        <button
          onClick={handleDownload}
          disabled={uploading || downloading || !profile.gistId}
          className="text-xs px-3 py-1.5 bg-nndd-border hover:bg-nndd-accent rounded disabled:opacity-50"
        >
          {downloading ? 'ダウンロード中…' : 'ダウンロード'}
        </button>
      </div>

      {resultMessage && <p className="text-xs text-nndd-subtext">{resultMessage}</p>}
    </div>
  );
}
