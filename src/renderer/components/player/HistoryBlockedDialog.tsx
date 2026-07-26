import { useState } from 'react';

interface Props {
  onChoice: (allow: boolean, remember: boolean) => void;
}

/**
 * 視聴履歴非表示 (hideWatchHistory) 設定中に、年齢制限/限定公開などで
 * ゲスト扱いでの再生に失敗した場合の確認ダイアログ。
 */
export function HistoryBlockedDialog({ onChoice }: Props): JSX.Element {
  const [remember, setRemember] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-nndd-panel border border-nndd-border rounded shadow-lg w-[420px] p-4 space-y-3">
        <p className="text-sm">
          視聴履歴非表示設定中はこの動画を再生できません（年齢制限・限定公開の可能性があります）。
          視聴履歴を残して再生しますか？
        </p>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          今後もこの選択を記憶する（設定 &gt; 一般設定 &gt; プライバシーで変更可）
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1 border border-nndd-border rounded hover:bg-nndd-border/50"
            onClick={() => onChoice(false, remember)}
          >
            再生しない
          </button>
          <button
            className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            onClick={() => onChoice(true, remember)}
          >
            履歴を残して再生する
          </button>
        </div>
      </div>
    </div>
  );
}
