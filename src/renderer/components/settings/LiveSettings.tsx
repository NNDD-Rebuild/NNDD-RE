import { useConfig } from '@renderer/hooks/useConfig';

/** 設定 > 生放送 */
export function LiveSettings(): JSX.Element {
  const [allowMultiple, setAllowMultiple, loading] = useConfig<boolean>(
    'live.allowMultipleWindows',
    false
  );
  const [commentDisplay, setCommentDisplay, commentDisplayLoading] = useConfig<'side' | 'window'>(
    'live.commentListDisplay',
    'side'
  );
  const [onTop, setOnTop, onTopLoading] = useConfig<boolean>('live.commentWindowOnTop', true);
  const [autoFollow, setAutoFollow, autoFollowLoading] = useConfig<boolean>(
    'live.autoFollowMoveOrder',
    false
  );
  const [followNotify, setFollowNotify, followNotifyLoading] = useConfig<boolean>(
    'live.followNotify',
    false
  );
  const [notifyInterval, setNotifyInterval, notifyIntervalLoading] = useConfig<number>(
    'live.followNotifyIntervalMin',
    5
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
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm mt-3">
            <input
              type="checkbox"
              checked={autoFollow}
              disabled={autoFollowLoading}
              onChange={(e) => void setAutoFollow(e.target.checked)}
            />
            放送者の移動指示に自動で従う
          </label>
          <p className="text-xs text-nndd-subtext mt-1 ml-6">
            放送者が視聴者を別の番組へ誘導したとき、指定された待ち時間 (最短 5 秒) の後に自動で移動します。
            OFF の場合は、移動を案内するバナーを表示するだけです。
          </p>
        </div>
      </div>

      <div className="mb-5">
        <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">通知</div>
        <div className="pl-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input
              type="checkbox"
              checked={followNotify}
              disabled={followNotifyLoading}
              onChange={(e) => void setFollowNotify(e.target.checked)}
            />
            フォロー中の放送者が生放送を始めたら通知する
          </label>
          <div className="flex items-center gap-2 text-sm ml-6">
            確認間隔
            <input
              type="number"
              min={1}
              value={notifyInterval}
              disabled={notifyIntervalLoading || !followNotify}
              onChange={(e) => void setNotifyInterval(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
              className="w-16 bg-nndd-bg border border-nndd-border px-1 py-0.5 text-sm"
            />
            分 (最短 1 分)
          </div>
          <p className="text-xs text-nndd-subtext ml-6">
            ログイン中のみ動作します。通知をクリックすると、その番組を生放送プレイヤーで開きます。
            アプリを起動した直後に放送中の番組は通知しません。
          </p>
        </div>
      </div>

      <div className="mb-5">
        <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">コメントリスト</div>
        <div className="pl-3 space-y-2">
          <div className="text-sm">表示方式</div>
          {/* 動画プレイヤーの設定 (PlayerSettings の表示方式) と同じ表記 */}
          <div className="flex flex-col gap-2 text-xs ml-3">
            {(
              [
                ['side', 'タブ表示', 'サイドパネル内のタブとして表示'],
                ['window', '浮動ウィンドウ', '別ウィンドウで表示。ドラッグで移動可能']
              ] as const
            ).map(([value, label, desc]) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="live-comment-display"
                  checked={commentDisplay === value}
                  disabled={commentDisplayLoading}
                  onChange={() => void setCommentDisplay(value)}
                  className="mt-0.5"
                />
                <span>
                  {label}
                  <span className="block text-nndd-subtext">{desc}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-nndd-subtext ml-3">
            プレイヤーの操作バーの「💬 タブ / 💬 浮動」ボタンで、視聴中にも切り替えられます。
          </p>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input
              type="checkbox"
              checked={onTop}
              disabled={onTopLoading}
              onChange={(e) => void setOnTop(e.target.checked)}
            />
            コメントウィンドウを最前面に表示する
          </label>
        </div>
      </div>
    </div>
  );
}
