import { IpcChannel } from '@shared/types';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { useAppStore } from '../../store/useAppStore';
import type { VideoCardData } from './VideoCard';

interface Props {
  data: VideoCardData;
  /** 押下後にメニューを閉じる */
  onDone: () => void;
}

/**
 * VideoCard の右クリックメニューの「あとで見るに追加」項目。
 * ニコニコのあとで見る (サーバー側) へ直接追加する。未ログイン時は表示しない。
 */
export function AddToWatchLaterMenuItem({ data, onDone }: Props): JSX.Element | null {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const showToast = useAppStore((s) => s.showToast);
  if (!isLoggedIn) return null;

  const handleClick = async (): Promise<void> => {
    onDone();
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_ADD_VIDEO_DEFLIST, data.videoId);
      showToast('あとで見るに追加しました');
    } catch (e) {
      showToast(`あとで見るに追加できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  return (
    <button
      onClick={() => void handleClick()}
      className="w-full px-3 py-1.5 text-left hover:bg-nndd-border whitespace-nowrap"
    >
      🕒 あとで見るに追加
    </button>
  );
}
