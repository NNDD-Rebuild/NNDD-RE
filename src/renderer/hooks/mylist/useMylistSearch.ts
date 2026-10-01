import { useMemo, useRef, useState } from 'react';
import type { MyList, MyListItem } from '@shared/types';
import { IpcChannel } from '@shared/types';
import type { VideoCardData } from '@renderer/components/common/VideoCard';
import { PAGE_SIZE, mylistItemToCard, type Selected } from '@renderer/components/mylist/mylistUtils';

/**
 * マイリストタブのタイトル検索 (選択中リスト内)。
 * 検索欄に入力が入ると、現在ページ以外の全ページを取得して allItems にキャッシュし、それを絞り込む。
 * リスト切替時は呼び出し側が resetSearch() で検索語・キャッシュをクリアし、進行中の全件取得を中断する。
 */
export function useMylistSearch({
  selected,
  items,
  totalItems
}: {
  selected: Selected | null;
  items: VideoCardData[];
  totalItems: number;
}) {
  // タイトル検索 (選択中リスト内)
  const [searchText, setSearchText] = useState('');
  // 検索開始時に全ページを取得してキャッシュしたもの (未検索/未取得なら null)
  const [allItems, setAllItems] = useState<VideoCardData[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const cancelLoadAllRef = useRef(false);
  const isLoadingAllRef = useRef(false);
  // リスト切替 (resetSearch) ごとに進める世代。cancelLoadAllRef は次の全件取得の開始で false に戻るため、
  // 切替前のリストの取得が await から戻ったときに中断を見落とさないよう、世代でも判定する
  const loadAllGenRef = useRef(0);

  /** 進行中の全件取得を中断し、次の取得をすぐ開始できる状態に戻す */
  const cancelLoadAll = (): void => {
    cancelLoadAllRef.current = true;
    isLoadingAllRef.current = false;
    ++loadAllGenRef.current;
    // 中断した取得の完了処理は (世代が古いので) 読込中表示を下げないため、ここで下げる
    setLoadingAll(false);
  };

  /** 検索語・全件キャッシュをクリアし、進行中の全件取得を中断する (リスト切替時) */
  const resetSearch = (): void => {
    setSearchText('');
    setAllItems(null);
    cancelLoadAll();
  };

  /** 指定マイリストの全ページを取得して1つの配列にまとめる (検索・一括DL共用) */
  const fetchAllMylistPages = async (ml: MyList): Promise<VideoCardData[] | null> => {
    const gen = loadAllGenRef.current;
    const isCancelled = (): boolean => cancelLoadAllRef.current || gen !== loadAllGenRef.current;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const merged: VideoCardData[] = [];
    for (let p = 1; p <= totalPages; p++) {
      if (isCancelled()) return null;
      const data = await window.nndd.invoke<{ items: MyListItem[]; total: number }>(
        IpcChannel.MYLIST_FETCH_PAGE,
        // 全件先読み中は画像キャッシュを保存しない (検索確定時/DL時にヒット分だけ保存する)
        { url: ml.myListUrl, type: ml.type, page: p, pageSize: PAGE_SIZE, cacheImages: false }
      );
      if (isCancelled()) return null;
      const mapped = data.items.map((d) => ({ ...d, pubDate: new Date(d.pubDate) }));
      merged.push(...mapped.map(mylistItemToCard));
      setLoadedCount(merged.length);
    }
    return merged;
  };

  /** 検索欄に何か入力された時、現在ページ以外の残り全ページを取得して allItems にキャッシュする */
  const loadAllPagesForSearch = async (): Promise<void> => {
    if (selected?.kind !== 'mylist' || allItems !== null || totalItems <= items.length) return;
    if (isLoadingAllRef.current) return; // 連続入力による二重起動を防止
    isLoadingAllRef.current = true;
    cancelLoadAllRef.current = false;
    const gen = loadAllGenRef.current;
    setLoadingAll(true);
    setLoadedCount(0);
    try {
      const merged = await fetchAllMylistPages(selected.mylist);
      if (merged !== null) setAllItems(merged);
    } catch {
      // 失敗時は現在ページのみでの検索にフォールバック (allItems は null のまま)
    } finally {
      // リスト切替後は、切替先で始まった全件取得の読込中表示・二重起動防止を解除しない
      if (gen === loadAllGenRef.current) {
        setLoadingAll(false);
        isLoadingAllRef.current = false;
      }
    }
  };

  const handleSearchTextChange = (value: string): void => {
    setSearchText(value);
    if (value.trim()) {
      if (allItems === null) void loadAllPagesForSearch();
    } else {
      // 検索窓を空にしたら取得を中断 (世代も進め、中断が済む前の再入力でも全件取得を再開できるようにする)
      cancelLoadAll();
    }
  };

  /** 検索確定 (Enter): ヒットした分だけ画像キャッシュに保存する */
  const handleSearchConfirm = (): void => {
    if (!searchText.trim()) return;
    for (const it of filteredItems) {
      if (!it.thumbnailUrl) continue;
      window.nndd.invoke(IpcChannel.IMAGE_FETCH, it.thumbnailUrl).catch(() => {});
    }
  };

  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return items;
    const q = searchText.trim().toLowerCase();
    const base = allItems ?? items;
    return base.filter((it) => it.title.toLowerCase().includes(q));
  }, [items, allItems, searchText]);

  return {
    searchText,
    allItems,
    setAllItems,
    loadingAll,
    setLoadingAll,
    loadedCount,
    setLoadedCount,
    cancelLoadAllRef,
    filteredItems,
    resetSearch,
    fetchAllMylistPages,
    handleSearchTextChange,
    handleSearchConfirm
  };
}
