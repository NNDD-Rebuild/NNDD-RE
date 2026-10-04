import { useAppStore } from '@renderer/store/useAppStore';

/**
 * 下部ステータスバー。
 * 元: NNDD.mxml の下部の ConnectionStatusView 相当
 */
export function StatusBar(): JSX.Element {
  const statusMessage = useAppStore((s) => s.statusMessage);
  return (
    <div className="h-6 flex items-center px-3 bg-nndd-panel border-t border-nndd-border text-xs text-nndd-subtext">
      {statusMessage || ' '}
    </div>
  );
}
