import { useState } from 'react';
import type { MyList } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { useAppStore } from '../../store/useAppStore';
import type { VideoCardData } from './VideoCard';

interface Props {
  data: VideoCardData;
  /** 追加後にメニューを閉じる */
  onDone: () => void;
}

/**
 * VideoCard の右クリックメニューの「マイリストに追加」項目。
 * 自分のマイリスト (アカウントから取得できるもの) を一覧し、選んだリストへサーバー側に直接追加する。未ログイン時は表示しない。
 */
export function AddToMylistMenuItem({ data, onDone }: Props): JSX.Element | null {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const showToast = useAppStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mylists, setMylists] = useState<MyList[]>([]);
  if (!isLoggedIn) return null;

  const handleToggleOpen = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setLoading(true);
        window.nndd
          .invoke<MyList[]>(IpcChannel.MYLIST_FETCH_ACCOUNT)
          .then((list) => setMylists(list))
          .catch(console.error)
          .finally(() => setLoading(false));
      }
      return next;
    });
  };

  const handleAdd = async (ml: MyList): Promise<void> => {
    onDone();
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_SERVER_ADD_ITEM, { url: ml.myListUrl, videoId: data.videoId });
      showToast(`「${ml.myListName}」に追加しました`);
    } catch (e) {
      showToast(`マイリストに追加できませんでした: ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggleOpen}
        className="w-full px-3 py-1.5 text-left hover:bg-nndd-border whitespace-nowrap flex items-center justify-between gap-2"
      >
        <span>⭐ マイリストに追加</span>
        <span>▸</span>
      </button>
      {open && (
        <div
          className="absolute left-full top-0 bg-nndd-panel border border-nndd-border rounded shadow-lg py-1 text-xs min-w-[200px] max-h-64 overflow-y-auto z-[10000]"
          onClick={(e) => e.stopPropagation()}
        >
          {loading && <div className="px-3 py-1.5 text-nndd-subtext">読み込み中...</div>}
          {!loading && mylists.length === 0 && (
            <div className="px-3 py-1.5 text-nndd-subtext max-w-[240px] whitespace-normal">
              マイリストがありません。
            </div>
          )}
          {!loading &&
            mylists.map((ml) => (
              <button
                key={ml.myListUrl}
                onClick={() => void handleAdd(ml)}
                className="w-full px-3 py-1.5 text-left hover:bg-nndd-border truncate"
                title={ml.myListName}
              >
                {ml.myListName}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
