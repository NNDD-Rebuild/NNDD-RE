import { useEffect, useMemo, useState } from 'react';
import { IpcChannel } from '@shared/types';
import type { AccountDataCounts, AccountDataEntry, AccountDataTransferRequest } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { Btn, CheckRow, Hint, RadioGroup, Row, Section, Select, StatusText } from '../common';

type Kind = keyof AccountDataCounts;

const KIND_LABELS: Record<Kind, string> = {
  mylist: 'マイリスト登録',
  playlist: '自作プレイリスト',
  schedule: 'スケジュール',
  liveReservation: '生放送の録画予約'
};
const KINDS = Object.keys(KIND_LABELS) as Kind[];

/**
 * 設定 > バックアップ・移行 > アカウントのデータ移動。
 * マイリスト・プレイリスト・スケジュール・録画予約はアカウントごとに持つ。
 * 誤ったアカウントに紐づいたデータや、削除したアカウントに残ったデータを、別のアカウントへ移動・コピーする。
 */
export function AccountDataSection(): JSX.Element {
  const accounts = useAppStore((s) => s.accounts);
  const bumpImportRevision = useAppStore((s) => s.bumpImportRevision);
  const [entries, setEntries] = useState<AccountDataEntry[]>([]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string>('');
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ mylist: true, playlist: true, schedule: true, liveReservation: true });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const nameOf = (id: string): string => {
    if (id === '') return '未ログイン時のデータ';
    const a = accounts.accounts.find((x) => x.id === id);
    return a ? `${a.nickname} (${id})` : `ユーザーID ${id} (登録なし)`;
  };

  const reload = (): void => {
    window.nndd
      .invoke<AccountDataEntry[]>(IpcChannel.ACCOUNT_DATA_LIST)
      .then(setEntries)
      .catch(() => setEntries([]));
  };
  useEffect(reload, [accounts.activeId]);

  // 移動元に選べるもの: 登録済みのアカウントすべて (データが 0 件でも) と、データだけ残っている登録外の持ち主 (削除済みのアカウント・未ログイン時)
  const fromOptions = useMemo(() => {
    const ids = [...accounts.accounts.map((a) => a.id), ...entries.map((e) => e.id).filter((id) => !accounts.accounts.some((a) => a.id === id))];
    return ids;
  }, [accounts.accounts, entries]);

  // 移動元が未選択か、選べなくなったら、データのあるものを優先して選ぶ
  useEffect(() => {
    if (fromOptions.length === 0) {
      setFrom(null);
      return;
    }
    if (from === null || !fromOptions.includes(from)) setFrom(entries[0]?.id ?? fromOptions[0]);
  }, [fromOptions, entries, from]);

  const toOptions = useMemo(() => accounts.accounts.filter((a) => a.id !== from), [accounts.accounts, from]);
  // 移動先が未選択か、移動元と同じになったら選び直す (アクティブなアカウントを優先)
  useEffect(() => {
    if (toOptions.some((a) => a.id === to)) return;
    const active = toOptions.find((a) => a.id === accounts.activeId);
    setTo((active ?? toOptions[0])?.id ?? '');
  }, [toOptions, to, accounts.activeId]);

  const counts: AccountDataCounts = entries.find((e) => e.id === from)?.counts ?? { mylist: 0, playlist: 0, schedule: 0, liveReservation: 0 };
  const chosen = KINDS.filter((k) => kinds[k] && counts[k] > 0);

  const run = async (): Promise<void> => {
    if (from === null || !to) return;
    setBusy(true);
    setMessage(null);
    try {
      const req: AccountDataTransferRequest = { from, to, mode, kinds: { ...kinds } };
      // 件数が 0 の種類は送らない
      for (const k of KINDS) if (counts[k] === 0) req.kinds[k] = false;
      const done = await window.nndd.invoke<AccountDataCounts>(IpcChannel.ACCOUNT_DATA_TRANSFER, req);
      const detail = KINDS.filter((k) => req.kinds[k]).map((k) => `${KIND_LABELS[k]} ${done[k]} 件`).join('、');
      setMessage({ kind: 'ok', text: `${nameOf(to)} へ${mode === 'move' ? '移動' : 'コピー'}しました (${detail})` });
      bumpImportRevision();
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: toUserFriendlyErrorMessage(e) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Section title="アカウントのデータ移動">
      <Hint className="mb-2">
        マイリスト登録・自作プレイリスト・スケジュール・生放送の録画予約は、ニコニコのアカウントごとに分かれています。
        誤ったアカウントに入ったデータや、削除したアカウントに残ったデータを、別のアカウントへ移せます。
      </Hint>
      {from === null ? (
        <Hint>移動できるデータはありません。</Hint>
      ) : (
        <>
          <Row label="移動元">
            <Select value={from} onChange={(e) => { setFrom(e.target.value); setConfirming(false); }}>
              {fromOptions.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                  {id === accounts.activeId ? ' (使用中)' : ''}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="移動先" hint={toOptions.length === 0 ? '移動先にできる登録済みのアカウントがありません' : undefined}>
            <Select value={to} onChange={(e) => { setTo(e.target.value); setConfirming(false); }} disabled={toOptions.length === 0}>
              {toOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname} ({a.id}){a.id === accounts.activeId ? ' (使用中)' : ''}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="対象">
            <div>
              {KINDS.map((k) => (
                <CheckRow
                  key={k}
                  checked={kinds[k] && counts[k] > 0}
                  disabled={counts[k] === 0}
                  onChange={(v) => { setKinds({ ...kinds, [k]: v }); setConfirming(false); }}
                  label={`${KIND_LABELS[k]} (${counts[k]} 件)`}
                />
              ))}
            </div>
          </Row>
          <Row label="方法">
            <RadioGroup
              name="accountDataMode"
              value={mode}
              onChange={(v) => { setMode(v); setConfirming(false); }}
              options={[
                { value: 'move', label: '移動', hint: '移動元からは消えます' },
                { value: 'copy', label: 'コピー', hint: '移動元にも残ります' }
              ]}
            />
          </Row>
          {chosen.length === 0 && KINDS.every((k) => counts[k] === 0) && (
            <Hint className="mb-2">このアカウントには、移せるデータがありません。</Hint>
          )}
          <Hint className="mb-2">
            移動先に同じマイリストや番組がある場合は、移動先のものを残します。
            プレイリストは、ニコニコのマイリストとの同期が解除されます (同期先は元のアカウントのものなので)。
            スケジュールは、対象のマイリストも一緒に移さないと動きません。
          </Hint>
          <div className="flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs">
                  {nameOf(from)} の{chosen.map((k) => KIND_LABELS[k]).join('・')}を、{nameOf(to)} へ
                  {mode === 'move' ? '移動' : 'コピー'}します。
                </span>
                <Btn variant="primary" onClick={() => void run()} disabled={busy}>
                  {busy ? '処理中…' : '実行する'}
                </Btn>
                <Btn onClick={() => setConfirming(false)} disabled={busy}>
                  やめる
                </Btn>
              </>
            ) : (
              <Btn onClick={() => setConfirming(true)} disabled={busy || !to || chosen.length === 0}>
                {mode === 'move' ? '移動する…' : 'コピーする…'}
              </Btn>
            )}
          </div>
        </>
      )}
      {message && (
        <div className="mt-2">
          <StatusText kind={message.kind}>{message.text}</StatusText>
        </div>
      )}
    </Section>
  );
}
