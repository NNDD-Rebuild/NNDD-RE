import { useState, useEffect, useCallback } from 'react';
import type { NgListItem, NgListItemTypeValue } from '@shared/types';
import { NgListItemType } from '@shared/types';
import { useConfig } from '@renderer/hooks/useConfig';
import { useNgList } from '@renderer/hooks/player/useNgList';
import { Btn, Hint, PageTitle, Select, TextInput } from './common';

const STRENGTH_OPTIONS: { value: 'weak' | 'medium' | 'strong'; label: string; desc: string }[] = [
  { value: 'weak', label: '弱', desc: 'NGワードは完全一致のみ適用' },
  { value: 'medium', label: '中', desc: '部分一致も適用 (デフォルト)' },
  { value: 'strong', label: '強', desc: '上記に加え、短時間の連投コメントも自動非表示' }
];

const KIND_OPTIONS: { value: NgListItemTypeValue; label: string; placeholder: string; hasMatch?: true }[] = [
  { value: NgListItemType.WORD,    label: 'NGワード',   placeholder: 'NGワードを入力 (例: 荒らし)', hasMatch: true },
  { value: NgListItemType.USER_ID, label: 'NGユーザーID', placeholder: 'ユーザーIDを入力 (例: 12345678)' },
  { value: NgListItemType.COMMAND, label: 'NGコマンド',  placeholder: 'コマンドを入力 (例: big)' },
];

const TYPE_LABEL: Record<string, string> = {
  [NgListItemType.WORD]:       'ワード（部分）',
  [NgListItemType.WORD_EXACT]: 'ワード（完全）',
  [NgListItemType.USER_ID]:    'ユーザーID',
  [NgListItemType.COMMAND]:    'コマンド',
};

export function NgCommentSettings(): JSX.Element {
  const [ngStrength, setNgStrength] = useConfig<'weak' | 'medium' | 'strong'>(
    'player.ngStrength',
    'medium'
  );
  const { ngList, loaded, addNg, removeNg } = useNgList();
  const loading = !loaded;
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
