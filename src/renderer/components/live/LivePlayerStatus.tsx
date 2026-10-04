import type { LiveConnectionState, LiveNotice } from '@shared/types';
import { STATE_LABELS } from './liveFormat';

/** 運営コメント (映像の上端に帯で表示。リンクがあればリンクにする) */
export function OperatorCommentBanner({ notice }: { notice: LiveNotice }): JSX.Element {
  return (
    <div className="absolute top-0 inset-x-0 bg-black/70 text-white text-center text-sm py-1 px-2">
      {notice.link ? (
        <a href={notice.link} target="_blank" rel="noreferrer" className="underline">
          {notice.text}
        </a>
      ) : (
        notice.text
      )}
    </div>
  );
}

/**
 * 接続状態のメッセージ (エラー・終了・接続待ち)。
 * タイムシフトの視聴開始が必要な番組では、予約して視聴開始するボタンを出す
 */
export function LiveStatusOverlay({
  state,
  stateMessage,
  activationRequired,
  activating,
  onActivate
}: {
  state: LiveConnectionState;
  stateMessage: string;
  activationRequired: boolean;
  activating: boolean;
  onActivate: () => void;
}): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="bg-black/70 text-white px-4 py-3 rounded text-sm text-center max-w-md pointer-events-auto">
        <div>{stateMessage || STATE_LABELS[state]}</div>
        {activationRequired && (
          <>
            <div className="mt-2 text-xs text-neutral-300">
              視聴を開始すると視聴期限のカウントが始まります (取り消せません)。
            </div>
            <button
              onClick={onActivate}
              disabled={activating}
              className="mt-3 px-3 py-1 rounded bg-nndd-accent text-white hover:opacity-80 disabled:opacity-50"
            >
              {activating ? '処理中...' : 'タイムシフトを予約して視聴開始'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
