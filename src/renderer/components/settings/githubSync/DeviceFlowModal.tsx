import { useState } from 'react';
import { Btn, Hint, StatusText } from '../common';

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

        <Hint>
          ブラウザで <span className="text-nndd-text">{verificationUri}</span> を開き、
          以下のコードを入力してください。
        </Hint>

        <div className="flex items-center gap-2">
          <div className="flex-1 text-center text-2xl font-mono tracking-widest bg-nndd-bg border border-nndd-border rounded py-2 text-nndd-text">
            {userCode}
          </div>
          <Btn onClick={handleCopy} className="shrink-0">
            {copied ? 'コピー済み' : 'コピー'}
          </Btn>
        </div>

        <Hint className="min-h-[1rem]">{statusMessage}</Hint>
        {errorMessage && <StatusText kind="error">{errorMessage}</StatusText>}

        <div className="flex justify-end">
          <Btn onClick={onCancel}>キャンセル</Btn>
        </div>
      </div>
    </div>
  );
}
