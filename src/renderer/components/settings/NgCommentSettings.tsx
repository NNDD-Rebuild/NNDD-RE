import { useState, useEffect, useCallback } from 'react';
import type { NgListItem, NgListItemTypeValue } from '@shared/types';
import { NgListItemType } from '@shared/types';

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
  const [ngList, setNgList] = useState<NgListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<NgListItemTypeValue>(NgListItemType.WORD);
  const [matchExact, setMatchExact] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    window.nndd
      .invoke<NgListItem[]>(window.nndd.channels.NG_LIST_COMMENT)
      .then((list) => { setNgList(list ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const selectedKind = KIND_OPTIONS.find((o) => o.value === kind)!;
  const effectiveType: NgListItemTypeValue =
    kind === NgListItemType.WORD && matchExact ? NgListItemType.WORD_EXACT : kind;

  const handleAdd = useCallback(async (): Promise<void> => {
    const value = input.trim();
    if (!value) return;
    const item: NgListItem = { type: effectiveType, value };
    await window.nndd.invoke(window.nndd.channels.NG_ADD_COMMENT, item);
    setNgList((prev) => {
      const filtered = prev.filter((x) => !(x.type === effectiveType && x.value === value));
      return [...filtered, item];
    });
    setInput('');
  }, [input, effectiveType]);

  const handleRemove = useCallback(async (item: NgListItem): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.NG_REMOVE_COMMENT, item);
    setNgList((prev) => prev.filter((x) => !(x.type === item.type && x.value === item.value)));
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-nndd-subtext">読み込み中…</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-base font-bold text-nndd-text mb-1">NGコメント設定</h2>
        <p className="text-xs text-nndd-subtext">
          ここで登録したNG設定は全動画に適用されます。プレイヤー内の右クリックからも追加できます。
        </p>
      </div>

      {/* 入力フォーム */}
      <div className="flex gap-2 items-center">
        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value as NgListItemTypeValue); setMatchExact(false); setInput(''); }}
          className="text-xs bg-nndd-bg border border-nndd-border rounded px-2 py-1.5 shrink-0"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {selectedKind.hasMatch && (
          <select
            value={matchExact ? 'exact' : 'partial'}
            onChange={(e) => setMatchExact(e.target.value === 'exact')}
            className="text-xs bg-nndd-bg border border-nndd-border rounded px-2 py-1.5 shrink-0"
          >
            <option value="partial">部分一致</option>
            <option value="exact">完全一致</option>
          </select>
        )}

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={selectedKind.placeholder}
          className="flex-1 px-2 py-1.5 text-xs bg-nndd-bg border border-nndd-border rounded min-w-0"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-xs bg-nndd-accent text-white rounded hover:opacity-80 shrink-0"
        >
          追加
        </button>
      </div>

      {/* 登録一覧 */}
      <div>
        <div className="text-xs text-nndd-subtext mb-1">登録済み — {ngList.length} 件</div>
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
