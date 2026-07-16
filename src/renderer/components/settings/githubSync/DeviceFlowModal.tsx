import { useState } from 'react';

export function DeviceFlowModal({
  userCode,
  verificationUri,
  statusMessage,
  errorMessage,
  onCancel
}: {
  userCode: string;
  verificationUri: string;
  statusMessage: string;
  errorMessage: string | null;
  onCancel: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-nndd-panel border border-nndd-border rounded p-6 w-96 space-y-4">
        <h3 className="text-sm font-bold text-nndd-text">GitHubでログイン</h3>

        <p className="text-xs text-nndd-subtext">
          ブラウザで <span className="text-nndd-text">{verificationUri}</span> を開き、
          以下のコードを入力してください。
        </p>

        <div className="flex items-center gap-2">
          <div className="flex-1 text-center text-2xl font-mono tracking-widest bg-nndd-bg border border-nndd-border rounded py-2 text-nndd-text">
            {userCode}
          </div>
          <button
            onClick={handleCopy}
            className="text-xs px-3 py-2 bg-nndd-border hover:bg-nndd-accent rounded shrink-0"
          >
            {copied ? 'コピー済み' : 'コピー'}
          </button>
        </div>

        <p className="text-xs text-nndd-subtext min-h-[1rem]">{statusMessage}</p>
        {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}

        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 bg-nndd-border hover:bg-nndd-accent rounded"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
