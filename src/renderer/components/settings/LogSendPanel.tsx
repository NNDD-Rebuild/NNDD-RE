import { useEffect, useRef, useState } from 'react';
import type {
  LogExportDeleteResult,
  LogExportHistoryItem,
  LogExportOptions,
  LogExportPreview,
  LogExportRange,
  LogExportSendResult
} from '@shared/types';
import { Btn, ButtonGroup } from './common';

type Mode = 'sessions' | 'time';

const inputCls =
  'bg-nndd-bg text-nndd-text border border-nndd-border rounded px-1.5 py-0.5 text-xs';

/** datetime-local の値 (ローカル時刻) を epoch ms に変換。空・不正なら null */
function toMs(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/** 開発者へのログ送信。範囲指定 → マスク済みプレビュー → 確認 → 送信 → ID 表示 */
export function LogSendPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [mode, setMode] = useState<Mode>('sessions');
  const [count, setCount] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<LogExportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const previewSeq = useRef(0);
  const [history, setHistory] = useState<LogExportHistoryItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [maskVideoIds, setMaskVideoIds] = useState(false);
  const [maskChannels, setMaskChannels] = useState(false);
  const [maskNames, setMaskNames] = useState(false);

  const loadHistory = (): void => {
    window.nndd
      .invoke<LogExportHistoryItem[]>(window.nndd.channels.LOG_EXPORT_HISTORY)
      .then(setHistory)
      .catch(() => undefined);
  };

  /** 送信先の状態に合わせる (web で消した分、保存期間が過ぎた分を履歴から外す) */
  const syncHistory = (): void => {
    window.nndd
      .invoke<LogExportHistoryItem[]>(window.nndd.channels.LOG_EXPORT_SYNC)
      .then(setHistory)
      .catch(() => undefined);
  };

  // 先にローカルの履歴を出し、続けて送信先と照合する
  useEffect(() => {
    loadHistory();
    syncHistory();
  }, []);

  const handleDelete = async (item: LogExportHistoryItem): Promise<void> => {
    if (
      !window.confirm(
        `送信したログ ${item.id} を、開発者のサーバーから削除します。元に戻せません。よろしいですか？`
      )
    ) {
      return;
    }
    setError(null);
    setDeletingId(item.id);
    try {
      const res = await window.nndd.invoke<LogExportDeleteResult>(
        window.nndd.channels.LOG_EXPORT_DELETE,
        item.id
      );
      if (!res.ok) setError(res.error);
      if (sentId === item.id) setSentId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
      syncHistory();
    }
  };

  const buildRange = (): LogExportRange | null => {
    if (mode === 'sessions') return { kind: 'sessions', count: Math.max(1, Math.floor(count)) };
    const fromMs = toMs(from);
    const toMsV = toMs(to);
    if (fromMs === null || toMsV === null) {
      setError('開始と終了の日時を指定してください');
      return null;
    }
    if (fromMs > toMsV) {
      setError('開始が終了より後になっています');
      return null;
    }
    // datetime-local は分単位。終了の分の終わり (59.999秒) まで含める
    return { kind: 'time', fromMs, toMs: toMsV + 59_999 };
  };

  const handlePreview = async (opts?: Partial<LogExportOptions>): Promise<void> => {
    setError(null);
    setSentId(null);
    setAgreed(false);
    const options: LogExportOptions = { maskVideoIds, maskChannels, maskNames, ...opts };
    const range = buildRange();
    if (!range) return;
    const seq = ++previewSeq.current;
    setBusy(true);
    try {
      const res = await window.nndd.invoke<LogExportPreview>(
        window.nndd.channels.LOG_EXPORT_PREVIEW,
        range,
        options
      );
      // チェックを素早く切り替えたとき、古い要求の結果は捨てる
      if (seq === previewSeq.current) setPreview(res);
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      if (seq === previewSeq.current) setBusy(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const res = await window.nndd.invoke<LogExportSendResult>(
        window.nndd.channels.LOG_EXPORT_SEND,
        preview.previewId
      );
      if (res.ok) {
        setSentId(res.id);
        setPreview(null);
        loadHistory();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-2 border border-nndd-border bg-nndd-panel text-xs">
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm">開発者にログを送る</span>
        <Btn className="ml-auto" onClick={onClose}>
          閉じる
        </Btn>
      </div>
      <p className="text-nndd-subtext">
        不具合の調査用に、選んだ範囲のログを開発者へ送ります。Cookie、トークン、ユーザーID、メールアドレス、PCのユーザー名などは自動で伏せ字にします。下のプレビューが、そのまま送られる内容です。
      </p>

      {sentId ? (
        <div className="flex flex-col gap-2 p-2 border border-nndd-border rounded">
          <div>送信しました。次のIDを開発者に伝えてください。</div>
          <div className="flex items-center gap-2">
            <code className="text-base font-mono select-all">{sentId}</code>
            <Btn onClick={() => void navigator.clipboard.writeText(sentId)}>コピー</Btn>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ButtonGroup
              value={mode}
              onChange={(v) => {
                setMode(v);
                setPreview(null);
              }}
              options={[
                { value: 'sessions', label: '起動単位' },
                { value: 'time', label: '日時指定' }
              ]}
            />
            {mode === 'sessions' ? (
              <label className="flex items-center gap-1">
                直近
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={`${inputCls} w-16`}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
                回の起動分 (1 = 今回の起動のみ)
              </label>
            ) : (
              <>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                〜
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </>
            )}
            <Btn onClick={() => void handlePreview()} disabled={busy}>
              プレビュー
            </Btn>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-nndd-subtext">さらに隠す:</span>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={maskVideoIds}
                onChange={(e) => {
                  setMaskVideoIds(e.target.checked);
                  if (preview) void handlePreview({ maskVideoIds: e.target.checked });
                }}
              />
              動画ID・タイトル・サムネイルURL
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={maskChannels}
                onChange={(e) => {
                  setMaskChannels(e.target.checked);
                  if (preview) void handlePreview({ maskChannels: e.target.checked });
                }}
              />
              チャンネルID・名前
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={maskNames}
                onChange={(e) => {
                  setMaskNames(e.target.checked);
                  if (preview) void handlePreview({ maskNames: e.target.checked });
                }}
              />
              マイリスト・シリーズ・予約の名前
            </label>
            <span className="text-nndd-subtext">
              ログの定型的な書式だけに効きます。プレビューで確認してください
            </span>
          </div>

          {preview && (
            <>
              <div className="text-nndd-subtext">
                {preview.lineCount} 件 / {fmtBytes(preview.bytes)}
                {preview.firstAt && preview.lastAt
                  ? ` / ${new Date(preview.firstAt).toLocaleString()} 〜 ${new Date(preview.lastAt).toLocaleString()}`
                  : ''}
              </div>
              {preview.oldestMissing && (
                <div className="text-yellow-400">
                  指定した回数ぶんの起動は残っていません。残っている先頭からの分です (古いログはローテーションで消えている可能性があります)。
                </div>
              )}
              {preview.truncated && (
                <div className="text-yellow-400">
                  サイズ上限を超えたため、古い側を切り捨てています。
                </div>
              )}
              <pre className="flex-1 min-h-[8rem] overflow-auto bg-black/40 p-2 font-mono whitespace-pre-wrap">
                {preview.text || '(該当するログがありません)'}
              </pre>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                プレビューの内容を確認し、開発者へ送信することに同意します
              </label>
              <div>
                <Btn
                  variant="primary"
                  onClick={() => void handleSend()}
                  disabled={busy || !agreed || preview.lineCount === 0}
                >
                  送信してIDを発行
                </Btn>
              </div>
            </>
          )}
        </>
      )}
      {history.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-nndd-border pt-2">
          <div className="flex items-center gap-2">
            <span className="font-bold">送信済みのログ</span>
            <Btn onClick={syncHistory}>最新の状態に更新</Btn>
          </div>
          <div className="text-nndd-subtext">
            送ってから30日で自動的に削除されます。それより前に消したいときは、ここから削除できます。開発者側で消えたログは、更新すると一覧から外れます。
          </div>
          <ul className="max-h-40 overflow-auto flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <code className="font-mono select-all">{h.id}</code>
                <span className="text-nndd-subtext">
                  {new Date(h.uploadedAt).toLocaleString()} / {fmtBytes(h.bytes)} / {h.range}
                </span>
                <Btn
                  variant="danger"
                  className="ml-auto"
                  disabled={deletingId !== null || !h.deletable}
                  title={h.deletable ? undefined : '旧形式の送信のため、アプリからは削除できません'}
                  onClick={() => void handleDelete(h)}
                >
                  削除
                </Btn>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="text-red-400">{error}</div>}
    </div>
  );
}
