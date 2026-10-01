import { useRef, useState } from 'react';

/**
 * 視聴履歴非表示中の再生失敗時に「履歴を残して再取得するか」を尋ねるダイアログの状態。
 * askHistoryBlocked() はユーザーが選ぶまで待つ Promise を返す。
 */
export function useHistoryBlockedPrompt(): {
  showHistoryBlockedDialog: boolean;
  askHistoryBlocked: () => Promise<boolean>;
  handleHistoryBlockedChoice: (allow: boolean, remember: boolean) => Promise<void>;
} {
  const [showHistoryBlockedDialog, setShowHistoryBlockedDialog] = useState(false);
  const historyBlockedResolverRef = useRef<((allow: boolean) => void) | null>(null);

  /** 履歴非表示中の再生失敗時、履歴を残して再取得するかユーザーに確認する */
  const askHistoryBlocked = (): Promise<boolean> => {
    return new Promise((resolve) => {
      historyBlockedResolverRef.current = resolve;
      setShowHistoryBlockedDialog(true);
    });
  };

  const handleHistoryBlockedChoice = async (allow: boolean, remember: boolean): Promise<void> => {
    setShowHistoryBlockedDialog(false);
    if (remember) {
      await window.nndd.invoke(
        window.nndd.channels.CONFIG_SET,
        'sensitiveVideoHistoryPolicy',
        allow ? 'allow' : 'deny'
      ).catch(() => {});
    }
    historyBlockedResolverRef.current?.(allow);
    historyBlockedResolverRef.current = null;
  };

  return { showHistoryBlockedDialog, askHistoryBlocked, handleHistoryBlockedChoice };
}
