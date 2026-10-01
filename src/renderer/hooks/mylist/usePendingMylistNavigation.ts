import { useEffect, type MutableRefObject } from 'react';
import type { MyList } from '@shared/types';
import { IpcChannel, RssType } from '@shared/types';
import { channelUrl, mylistUrl } from '@shared/utils/nicoUrl';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * プレイヤーウィンドウ等からのナビゲーション (pendingMylistId / pendingSeriesId / pendingChannelId) を処理する。
 * - マイリスト: 登録済みならそれを選択、未登録なら DB に保存せず一時表示
 * - シリーズ: showSeries に委譲 (一時表示)
 * - チャンネル: DB に保存せず一時表示
 * 3 つの effect はこの順で宣言する (元の MyListView 内と同じ順序)。
 */
export function usePendingMylistNavigation({
  mylistsRef,
  fetchItems,
  showSeries
}: {
  /** mylists が更新された後に処理するために ref で保持したもの */
  mylistsRef: MutableRefObject<MyList[]>;
  fetchItems: (ml: MyList) => Promise<void>;
  showSeries: (seriesId: string) => Promise<void>;
}): void {
  const pendingMylistId = useAppStore((s) => s.pendingMylistId);
  const setPendingMylistId = useAppStore((s) => s.setPendingMylistId);
  const pendingSeriesId = useAppStore((s) => s.pendingSeriesId);
  const setPendingSeriesId = useAppStore((s) => s.setPendingSeriesId);
  const pendingChannelId = useAppStore((s) => s.pendingChannelId);
  const setPendingChannelId = useAppStore((s) => s.setPendingChannelId);

  // pendingMylistId 処理: マイリストを自動選択/追加
  useEffect(() => {
    if (!pendingMylistId) return;
    const mylistId = pendingMylistId;
    setPendingMylistId(null);

    const list = mylistsRef.current;
    // 既存から検索 (URLにIDが含まれるものを探す)
    const existing = list.find((m) =>
      m.myListUrl === mylistId ||
      m.myListUrl.includes(`mylist/${mylistId}`) ||
      m.myListUrl.includes(`mylist%2F${mylistId}`)
    );
    if (existing) {
      void fetchItems(existing);
    } else {
      // 追加せず一時表示のみ (DBには保存しない)
      const url = mylistUrl(mylistId);
      const fetchAndShow = async (): Promise<void> => {
        // マイリスト名を取得して表示名に使用
        const info = await window.nndd.invoke<{ name: string } | null>(
          IpcChannel.MYLIST_FETCH_INFO,
          { url, type: RssType.MY_LIST }
        ).catch(() => null);
        const tempMl: MyList = {
          myListUrl: url,
          myListName: info?.name ?? `マイリスト (${mylistId})`,
          type: RssType.MY_LIST,
          isDir: false,
          unPlayVideoCount: 0,
          myListVideoIds: {},
        };
        void fetchItems(tempMl); // reloadMylists は呼ばない → DBに追加されない
      };
      void fetchAndShow();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMylistId]);

  // pendingSeriesId 処理: シリーズを一時表示 (SERIES_FETCH → 直接setItems)
  useEffect(() => {
    if (!pendingSeriesId) return;
    const seriesId = pendingSeriesId;
    setPendingSeriesId(null);
    void showSeries(seriesId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeriesId]);

  // pendingChannelId 処理: チャンネル動画一覧を一時表示 (DBには保存しない)
  useEffect(() => {
    if (!pendingChannelId) return;
    const channelId = pendingChannelId;
    setPendingChannelId(null);
    const url = channelUrl(channelId);
    const fetchAndShow = async (): Promise<void> => {
      const info = await window.nndd.invoke<{ name: string } | null>(
        IpcChannel.MYLIST_FETCH_INFO,
        { url, type: RssType.CHANNEL }
      ).catch(() => null);
      const tempMl: MyList = {
        myListUrl: url,
        myListName: info?.name ?? `チャンネル (${channelId})`,
        type: RssType.CHANNEL,
        isDir: false,
        unPlayVideoCount: 0,
        myListVideoIds: {},
      };
      void fetchItems(tempMl);
    };
    void fetchAndShow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChannelId]);
}
