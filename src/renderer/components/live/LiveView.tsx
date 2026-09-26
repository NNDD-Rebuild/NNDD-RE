import { useState } from 'react';
import { IpcChannel } from '@shared/types';

/**
 * メインウィンドウ「生放送」タブ。
 * 番組ID (lv/co/ch) または生放送の URL を入力して生放送プレイヤーを開く。
 */
export function LiveView(): JSX.Element {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const open = async (): Promise<void> => {
    const value = input.trim();
    if (!value) return;
    setError('');
    try {
      await window.nndd.invoke(IpcChannel.LIVE_OPEN_PLAYER, value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
    }
  };

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">生放送</h2>
      <div className="text-xs text-nndd-subtext mb-2">
        番組ID (lv...)、コミュニティ/チャンネルID (co... / ch...)、または生放送ページの URL を入力してください。
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          placeholder="lv123456789 / https://live.nicovideo.jp/watch/lv123456789"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-3 py-1 text-sm rounded bg-nndd-accent text-white disabled:opacity-50"
        >
          視聴
        </button>
      </form>
      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
    </div>
  );
}
