interface Props {
  videoId: string;
  msg?: string;
  onJump: () => void;
  onCancel: () => void;
}

/**
 * ニコスクリプトの ＠ジャンプ で別の動画へ移る前の確認ダイアログ。
 * 元: JumpDialog.mxml
 */
export function JumpConfirmDialog({ videoId, msg, onJump, onCancel }: Props): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-nndd-panel border border-nndd-border rounded shadow-lg w-[360px] p-4 space-y-3">
        <div className="text-sm font-semibold">ジャンプの確認</div>
        <p className="text-sm">次の動画へジャンプします。</p>
        <p className="text-sm font-mono break-all">{videoId}</p>
        {msg && <p className="text-xs text-nndd-subtext break-all">{msg}</p>}
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1 border border-nndd-border rounded hover:bg-nndd-border/50"
            onClick={onCancel}
            autoFocus
          >
            ジャンプしない
          </button>
          <button
            className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            onClick={onJump}
          >
            次の動画へジャンプ
          </button>
        </div>
      </div>
    </div>
  );
}
