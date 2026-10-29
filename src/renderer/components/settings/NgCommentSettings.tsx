import { useState, useEffect, useCallback } from 'react';
import type { NgListItem, NgListItemTypeValue } from '@shared/types';
import { IpcChannel, NgListItemType } from '@shared/types';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { useConfig } from '@renderer/hooks/useConfig';
import { useNgList } from '@renderer/hooks/player/useNgList';
import { useAppStore } from '@renderer/store/useAppStore';
import type { NgSyncResult } from '@shared/types/ngSync';
import { Btn, CheckRow, Hint, PageTitle, Select, StatusText, TextInput } from './common';

const STRENGTH_OPTIONS: { value: 'weak' | 'medium' | 'strong'; label: string; desc: string }[] = [
  { value: 'weak', label: '弱', desc: 'NGワードは完全一致のみ適用' },
  { value: 'medium', label: '中', desc: '部分一致も適用 (デフォルト)' },
  { value: 'strong', label: '強', desc: '上記に加え、短時間の連投コメントも自動非表示' }
];

const KIND_OPTIONS: { value: NgListItemTypeValue; label: string; placeholder: string; hasMatch?: true }[] = [
  { value: NgListItemType.WORD,    label: 'NGワード',   placeholder: 'NGワードを入力 (例: 荒らし)', hasMatch: true },
  { value: NgListItemType.USER_ID, label: 'NGユーザーID', placeholder: 'ユーザーIDを入力 (例: 12345678)' },
  { value: NgListItemType.COMMAND, label: 'NGコマンド',  placeholder: 'コマンドを入力 (例: big)' },
  { value: NgListItemType.PERMIT_ID, label: '許可ID', placeholder: '許可するユーザーIDを入力' },
];

const TYPE_LABEL: Record<string, string> = {
  [NgListItemType.WORD]:       'ワード（部分）',
  [NgListItemType.WORD_EXACT]: 'ワード（完全）',
  [NgListItemType.USER_ID]:    'ユーザーID',
  [NgListItemType.COMMAND]:    'コマンド',
  [NgListItemType.PERMIT_ID]:  '許可ID',
};

export function NgCommentSettings(): JSX.Element {
  const [ngStrength, setNgStrength] = useConfig<'weak' | 'medium' | 'strong'>(
    'player.ngStrength',
    'medium'
  );
  const { ngList, loaded, addNg, removeNg } = useNgList();
  const loading = !loaded;
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const [ngServerSync, setNgServerSync] = useConfig<boolean>('ngServerSync', false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  /** 削除が大量で中断されたとき、確認のうえ削除を含めて再実行するための保持 */
  const [pendingMassDelete, setPendingMassDelete] = useState(false);

  const handleSync = async (force = false): Promise<void> => {
    setSyncing(true);
    setSyncMessage(null);
    setPendingMassDelete(false);
    try {
      const r = await window.nndd.invoke<NgSyncResult>(IpcChannel.NG_SERVER_SYNC, { force });
      if (r.aborted === 'massDelete') {
        setPendingMassDelete(true);
        setSyncMessage({
          kind: 'warn',
          text: `削除が多いため中断しました (ローカルから ${r.deletedLocal} 件、ニコニコ側から ${r.deletedServer} 件の削除予定)。内容を確認し、問題なければ下のボタンで実行してください`
        });
        return;
      }
      const parts = [
        `追加: ニコニコ側から ${r.pulled} 件取り込み、ニコニコ側へ ${r.pushed} 件送信`,
        `削除: ローカルから ${r.deletedLocal} 件、ニコニコ側から ${r.deletedServer} 件`
      ];
      if (r.localOnly > 0) parts.push(`ローカルのみ ${r.localOnly} 件`);
      if (r.failed > 0) parts.push(`反映失敗 ${r.failed} 件 (次回の同期で再試行します)`);
      if (r.limitReached) parts.push('ニコニコ側の登録上限に達したため残りは送れませんでした');
      setSyncMessage({ kind: r.limitReached || r.failed > 0 ? 'warn' : 'ok', text: parts.join(' / ') });
    } catch (e) {
      setSyncMessage({ kind: 'error', text: `同期に失敗しました: ${toUserFriendlyErrorMessage(e)}` });
    } finally {
      setSyncing(false);
    }
  };
  const [kind, setKind] = useState<NgListItemTypeValue>(NgListItemType.WORD);
  const [matchExact, setMatchExact] = useState(false);
  const [input, setInput] = useState('');

  const selectedKind = KIND_OPTIONS.find((o) => o.value === kind)!;
  const effectiveType: NgListItemTypeValue =
    kind === NgListItemType.WORD && matchExact ? NgListItemType.WORD_EXACT : kind;

  const handleAdd = useCallback(async (): Promise<void> => {
    const value = input.trim();
    if (!value) return;
    const item: NgListItem = { type: effectiveType, value };
    await addNg(item);
    setInput('');
  }, [input, effectiveType, addNg]);

  const handleRemove = removeNg;

  if (loading) {
    return <div className="p-6 text-sm text-nndd-subtext">読み込み中…</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <PageTitle title="NGコメント設定">
        ここで登録したNG設定は全動画に適用されます。プレイヤー内の右クリックからも追加できます。
      </PageTitle>

      {/* NG強度プリセット */}
      <div>
        <div className="flex gap-1">
          {STRENGTH_OPTIONS.map((opt) => (
            <Btn
              key={opt.value}
              variant={ngStrength === opt.value ? 'primary' : 'default'}
              onClick={() => setNgStrength(opt.value)}
            >
              {opt.label}
            </Btn>
          ))}
        </div>
        <Hint className="mt-1">{STRENGTH_OPTIONS.find((o) => o.value === ngStrength)?.desc}</Hint>
      </div>

      {/* ニコニコのサーバー側NGとの同期 */}
      <div className="border border-nndd-border rounded p-3 space-y-2">
        <div className="text-sm font-bold">ニコニコのNG設定と同期</div>
        <CheckRow
          checked={ngServerSync}
          onChange={(v) => void setNgServerSync(v)}
          disabled={!isLoggedIn}
          label="追加・削除をニコニコ側にも反映する"
          hint="ON の間、ここやプレイヤーで行った NG の追加・削除を、ニコニコのアカウントの NG 設定にもすぐ反映します。"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Btn variant="primary" onClick={() => void handleSync()} disabled={!isLoggedIn || syncing}>
            {syncing ? '同期中…' : '今すぐ同期'}
          </Btn>
          {pendingMassDelete && (
            <Btn onClick={() => void handleSync(true)} disabled={syncing}>
              削除を含めて同期する
            </Btn>
          )}
          {syncMessage && <StatusText kind={syncMessage.kind}>{syncMessage.text}</StatusText>}
        </div>
        <Hint>
          前回の同期との差分で、追加も削除も双方に反映します (どちらかで消した NG は、もう一方からも消えます)。初回は足し合わせるだけで、何も消えません。
          対応するのは「NGワード (部分一致)」と「NGユーザーID」です。完全一致ワード・コマンド・許可IDはこのアプリだけで保持します。
          {!isLoggedIn && ' ログインすると使えます。'}
        </Hint>
      </div>

      {/* 入力フォーム */}
      <div className="flex gap-2 items-center">
        <Select
          value={kind}
          onChange={(e) => { setKind(e.target.value as NgListItemTypeValue); setMatchExact(false); setInput(''); }}
          className="shrink-0"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        {selectedKind.hasMatch && (
          <Select
            value={matchExact ? 'exact' : 'partial'}
            onChange={(e) => setMatchExact(e.target.value === 'exact')}
            className="shrink-0"
          >
            <option value="partial">部分一致</option>
            <option value="exact">完全一致</option>
          </Select>
        )}

        <TextInput
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={selectedKind.placeholder}
          className="flex-1 min-w-0"
        />
        <Btn variant="primary" onClick={handleAdd} className="shrink-0">
          追加
        </Btn>
      </div>

      {/* 登録一覧 */}
      <div>
        <Hint className="mb-1">登録済み — {ngList.length} 件</Hint>
        {ngList.length === 0 ? (
          <div className="text-xs text-nndd-subtext italic">未登録</div>
        ) : (
          <div className="border border-nndd-border rounded divide-y divide-nndd-border max-h-96 overflow-y-auto">
            {ngList.map((item) => (
              <div
                key={`${item.type}-${item.value}`}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-nndd-border/30 group"
              >
                <span className="text-xs text-nndd-subtext shrink-0 w-24">{TYPE_LABEL[item.type] ?? item.type}</span>
                <span className="flex-1 text-xs break-all text-nndd-text">{item.value}</span>
                <button
                  onClick={() => handleRemove(item)}
                  className="text-xs text-nndd-subtext hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
