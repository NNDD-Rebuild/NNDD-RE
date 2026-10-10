import { useEffect, useState } from 'react';
import type { BackupResult, GistRevision } from '@shared/types';
import { Btn, Hint, StatusText } from '../common';

/**
 * Gist の世代 (リビジョン) 履歴モーダル。
 * 過去のバックアップ内容をローカルへ復元する (Gist自体は変更しない)。
 */
export function RevisionHistoryModal({
  profileId,
  onClose
}: {
  profileId: string;
  onClose: () => void;
}): JSX.Element {
  const [revisions, setRevisions] = useState<GistRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringSha, setRestoringSha] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await window.nndd.invoke<GistRevision[]>(
          window.nndd.channels.BACKUP_LIST_REVISIONS,
          profileId
        );
        setRevisions(list ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [profileId]);

  const handleRestore = async (rev: GistRevision): Promise<void> => {
    if (
      !window.confirm(
        `${formatLocaleDateTime(rev.committedAt)} 時点のバックアップ内容でローカルデータを置き換えます。よろしいですか?`
      )
    ) {
      return;
    }
    setRestoringSha(rev.sha);
    setResultMessage(null);
    try {
      const result = await window.nndd.invoke<BackupResult>(
        window.nndd.channels.BACKUP_RESTORE_REVISION,
        profileId,
        rev.sha
      );
      if (result?.ok) {
        setResultMessage('復元が完了しました。設定を反映するため画面をリロードします…');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setResultMessage(`復元に失敗しました: ${result?.error}`);
      }
    } finally {
      setRestoringSha(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-nndd-panel border border-nndd-border rounded-lg p-4 w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">世代履歴</h3>
          <Btn onClick={onClose}>閉じる</Btn>
        </div>

        <Hint className="mb-3">
          過去のバックアップ内容をローカルへ復元します。Gist自体(リモート)は変更されません。
        </Hint>

        {error && <StatusText kind="error">{error}</StatusText>}

        {!error && revisions === null && (
          <Hint>読み込み中…</Hint>
        )}

        {revisions !== null && revisions.length === 0 && (
          <Hint>履歴がありません</Hint>
        )}

        {revisions !== null && revisions.length > 0 && (
          <div className="overflow-y-auto divide-y divide-nndd-border border border-nndd-border rounded">
            {revisions.map((rev, idx) => (
              <div
                key={rev.sha}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="text-nndd-text">
                    {formatLocaleDateTime(rev.committedAt)}
                    {idx === 0 && (
                      <span className="ml-1.5 text-[10px] text-nndd-accent">(最新)</span>
                    )}
                  </div>
                  <div className="text-nndd-subtext">変更: {rev.totalChanges}行</div>
                </div>
                <Btn
                  onClick={() => handleRestore(rev)}
                  disabled={restoringSha !== null || idx === 0}
                  className="shrink-0 ml-2"
                >
                  {restoringSha === rev.sha ? '復元中…' : 'このバージョンを復元'}
                </Btn>
              </div>
            ))}
          </div>
        )}

        {resultMessage && <Hint className="mt-3">{resultMessage}</Hint>}
      </div>
    </div>
  );
}

/** 日時 (ja-JP ロケール、秒まで。例: 2024/1/5 9:03:07) */
function formatLocaleDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP');
}
