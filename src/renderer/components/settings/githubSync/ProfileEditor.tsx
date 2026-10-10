import { useState } from 'react';
import type { DataScope, GistSummary, SyncProfile } from '@shared/types';
import { RevisionHistoryModal } from './RevisionHistoryModal';
import { Btn, Card, CheckRow, Hint } from '../common';

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
  const [showRevisionHistory, setShowRevisionHistory] = useState(false);

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
    <Card title={profile.name}>

      <div>
        <Hint className="mb-2">同期対象データ</Hint>
        {SCOPE_LABELS.map((s) => (
          <CheckRow
            key={s.key}
            checked={!!profile.dataScope[s.key]}
            onChange={() => toggleScope(s.key)}
            label={s.label}
          />
        ))}
      </div>

      <div>
        <CheckRow
          checked={!!profile.autoUploadEnabled}
          onChange={onToggleAutoUpload}
          label="アプリ起動時・終了時に自動アップロード"
          hint="このプロファイルがアクティブな間のみ有効です。前回アップロード時から変更がない場合はスキップされます。ダウンロードは自動実行されません(手動のみ)。"
        />
      </div>

      <div>
        <Hint className="mb-2">Gist連携</Hint>
        {profile.gistId ? (
          <div className="text-xs">連携済み (Gist ID: {profile.gistId})</div>
        ) : (
          <div className="space-y-2">
            <Hint>
              未連携です。「アップロード」を実行すると新規Gistが自動作成されます。
              既存のGistに連携する場合は下から選択してください。
            </Hint>
            <Btn onClick={handleShowCandidates} disabled={loadingCandidates}>
              {loadingCandidates ? '検索中…' : '既存Gistを検索'}
            </Btn>
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
                      <span className="truncate">{g.description}</span>
                      <Btn onClick={() => onLinkGist(g.id)} className="shrink-0 ml-2">
                        連携
                      </Btn>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Btn variant="primary" onClick={onUpload} disabled={uploading || downloading}>
          {uploading ? 'アップロード中…' : 'アップロード'}
        </Btn>
        <Btn onClick={handleDownload} disabled={uploading || downloading || !profile.gistId}>
          {downloading ? 'ダウンロード中…' : 'ダウンロード'}
        </Btn>
        <Btn
          onClick={() => setShowRevisionHistory(true)}
          disabled={uploading || downloading || !profile.gistId}
          title="過去のバージョンを見て、任意の時点へ復元できます"
        >
          世代履歴
        </Btn>
      </div>

      {resultMessage && <Hint>{resultMessage}</Hint>}

      {showRevisionHistory && (
        <RevisionHistoryModal
          profileId={profile.id}
          onClose={() => setShowRevisionHistory(false)}
        />
      )}
    </Card>
  );
}
