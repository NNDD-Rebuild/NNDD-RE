import { useConfig } from '@renderer/hooks/useConfig';

/** 設定 > 生放送 */
export function LiveSettings(): JSX.Element {
  const [allowMultiple, setAllowMultiple, loading] = useConfig<boolean>(
    'live.allowMultipleWindows',
    false
  );

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">生放送</h2>

      <div className="mb-5">
        <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">プレイヤー</div>
        <div className="pl-3">
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input
              type="checkbox"
              checked={allowMultiple}
              disabled={loading}
              onChange={(e) => void setAllowMultiple(e.target.checked)}
            />
            別の番組を新しいウィンドウで開く
          </label>
          <p className="text-xs text-nndd-subtext mt-1 ml-6">
            OFF の場合、開いている生放送プレイヤーで番組を切り替えます。
            同じ番組は設定に関わらず 1 つのウィンドウでのみ開きます。
          </p>
        </div>
      </div>
    </div>
  );
}
