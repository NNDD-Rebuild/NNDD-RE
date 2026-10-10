import { useState } from 'react';
import type { TelemetryState } from '@shared/types';
import { TelemetryNotice } from './TelemetryNotice';

/**
 * 匿名の利用統計に協力するかを尋ねるダイアログ (初回起動・更新後の初回)。
 * 選ぶまで閉じない (外側クリック・Esc では閉じない)。選ぶまで何も送られない。
 */
export function TelemetryConsentDialog({ onDone }: { onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const answer = async (granted: boolean): Promise<void> => {
    setBusy(true);
    setError(false);
    try {
      await window.nndd.invoke<TelemetryState>(window.nndd.channels.TELEMETRY_SET_CONSENT, granted);
      onDone();
    } catch {
      // 保存できなかったときは閉じずに、もう一度選べるようにする
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="w-[36rem] max-w-[92vw] max-h-[85vh] overflow-auto p-4 bg-nndd-panel border border-nndd-border rounded shadow-lg space-y-3">
        <div className="text-sm font-semibold">匿名の利用統計への協力のお願い</div>
        <div className="text-xs text-nndd-text">
          NNDD-RE をより良くするため、どの機能がよく使われているかを匿名で集計させてください。
          協力するかどうかはここで選べます。
        </div>
        <TelemetryNotice />
        {error && <div className="text-xs text-red-500 dark:text-red-400">⚠ 保存できませんでした。もう一度選んでください。</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            disabled={busy}
            onClick={() => void answer(false)}
            className="text-xs px-3 py-1 bg-nndd-border text-nndd-text rounded hover:opacity-80 disabled:opacity-50"
          >
            送信しない
          </button>
          <button
            disabled={busy}
            onClick={() => void answer(true)}
            className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            送信する
          </button>
        </div>
      </div>
    </div>
  );
}
