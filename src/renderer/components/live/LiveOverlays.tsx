import type {
  LiveCommentLock,
  LiveCreatorSupport,
  LiveEnquete,
  LiveMoveOrder
} from '@shared/types';

/**
 * 生放送プレイヤーの映像に重ねて表示する小さなパネル類。
 * 放送者の操作 (アンケート・コメント制限・移動指示など) に応じて出し入れする。
 */

/** アンケート。投票中は選択肢、結果表示では得票率のバーを出す (投票そのものは視聴ページ側の機能で、ここは表示のみ) */
export function EnqueteOverlay({
  enquete,
  onClose
}: {
  enquete: LiveEnquete;
  onClose: () => void;
}): JSX.Element {
  const isResult = enquete.status === 'result';
  return (
    <div className="absolute left-2 bottom-2 w-72 max-w-[60%] rounded bg-black/80 text-white text-xs shadow-lg pointer-events-auto">
      <div className="flex items-start gap-2 px-2 py-1.5 border-b border-white/20">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-nndd-accent font-bold">
            アンケート{isResult ? ' (結果)' : ' (投票中)'}
          </div>
          <div className="font-bold break-words">{enquete.question}</div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 px-1 text-white/70 hover:text-white"
          title="閉じる (次のアンケートが来ると再び表示されます)"
        >
          ×
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {enquete.choices.map((c, i) => {
          const percent = c.perMille !== undefined ? c.perMille / 10 : undefined;
          return (
            <div key={i}>
              <div className="flex justify-between gap-2">
                <span className="break-words min-w-0">
                  {i + 1}. {c.description}
                </span>
                {isResult && percent !== undefined && (
                  <span className="shrink-0 tabular-nums">{percent.toFixed(1)}%</span>
                )}
              </div>
              {isResult && percent !== undefined && (
                <div className="h-1.5 rounded bg-white/20 overflow-hidden">
                  <div className="h-full bg-nndd-accent" style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** クリエイターサポートの目標ゲージ (映像の上端に細く出す) */
export function CreatorSupportBar({ support }: { support: LiveCreatorSupport }): JSX.Element {
  const percent = Math.max(0, Math.min(100, support.progressRatio * 100));
  const name = support.rewardDisplayName || support.rewardName;
  return (
    <div
      className="absolute right-2 top-2 w-52 max-w-[40%] rounded bg-black/70 text-white text-[10px] px-2 py-1 pointer-events-none"
      title={`クリエイターサポート目標: ${name} (${support.currentPoint.toLocaleString()} / ${support.upperPoint.toLocaleString()} pt)`}
    >
      <div className="flex justify-between gap-2">
        <span className="truncate">{support.isAchieved ? '🎉 達成: ' : '目標: '}{name}</span>
        <span className="shrink-0 tabular-nums">{percent.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 mt-0.5 rounded bg-white/20 overflow-hidden">
        <div
          className={support.isAchieved ? 'h-full bg-green-400' : 'h-full bg-nndd-accent'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** 最低フォロー期間 (秒) を「3日」「12時間」のような表記にする */
function formatFollowDuration(sec: number): string {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}日`;
  if (sec >= 3600) return `${Math.floor(sec / 3600)}時間`;
  if (sec >= 60) return `${Math.floor(sec / 60)}分`;
  return `${sec}秒`;
}

/** コメント制限の説明。制限がなければ null */
export function commentLockText(lock: LiveCommentLock | null): string | null {
  if (!lock || lock.status === 'unrestricted') return null;
  if (lock.status === 'locked') return 'コメント投稿は制限されています';
  return lock.minimumFollowSec
    ? `コメント投稿にはフォロー${formatFollowDuration(lock.minimumFollowSec)}以上が必要です`
    : 'コメント投稿は条件付きで制限されています';
}

/** コメント制限の表示 (投稿 UI はまだ無いので状態表示のみ) */
export function CommentLockChip({ lock }: { lock: LiveCommentLock }): JSX.Element | null {
  const text = commentLockText(lock);
  if (!text) return null;
  return (
    <div
      className="absolute left-2 top-2 max-w-[50%] rounded bg-black/70 text-white text-[10px] px-2 py-0.5 pointer-events-none"
      title={text}
    >
      🔒 {text}
    </div>
  );
}

/** 別番組への移動指示。自動で移動するときはカウントダウンを出す */
export function MoveOrderBanner({
  order,
  secondsLeft,
  onOpen,
  onClose
}: {
  order: LiveMoveOrder;
  /** 自動で移動するまでの残り秒数 (自動移動しないときは null) */
  secondsLeft: number | null;
  onOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="absolute inset-x-0 top-8 mx-auto w-96 max-w-[80%] rounded bg-nndd-accent/95 text-white text-xs shadow-lg px-3 py-2 pointer-events-auto">
      <div className="font-bold mb-0.5">
        {order.kind === 'jump' ? '別の番組へ移動する指示が届きました' : '別のページへ移動する指示が届きました'}
      </div>
      {order.message && <div className="break-words mb-1">{order.message}</div>}
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate opacity-80">{order.target}</span>
        {secondsLeft !== null && <span className="tabular-nums">{secondsLeft}秒後に移動</span>}
        <button onClick={onOpen} className="shrink-0 px-2 py-0.5 rounded bg-white/25 hover:bg-white/40">
          移動する
        </button>
        <button onClick={onClose} className="shrink-0 px-2 py-0.5 rounded bg-white/10 hover:bg-white/25">
          {secondsLeft !== null ? '中止' : '閉じる'}
        </button>
      </div>
    </div>
  );
}
