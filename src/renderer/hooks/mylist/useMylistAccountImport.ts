import { useState } from 'react';
import type { MyList } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';

/**
 * ログイン中アカウントのマイリスト一覧を取得し、個別/一括で登録する。
 * mylists は登録済み判定用、reloadMylists は登録後の左ペイン再読込用。
 */
export function useMylistAccountImport({
  mylists,
  reloadMylists
}: {
  mylists: MyList[];
  reloadMylists: () => void;
}) {
  const [accountFetching, setAccountFetching] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountMylists, setAccountMylists] = useState<MyList[] | null>(null);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());

  // アカウントのマイリスト一覧を取得
  const handleFetchAccount = async (): Promise<void> => {
    setAccountFetching(true);
    setAccountError(null);
    setAccountMylists(null);
    try {
      const list = await window.nndd.invoke<MyList[]>(IpcChannel.MYLIST_FETCH_ACCOUNT);
      setAccountMylists(list);
    } catch (e) {
      setAccountError(toUserFriendlyErrorMessage(e));
    } finally {
      setAccountFetching(false);
    }
  };

  const handleImportOne = async (ml: MyList): Promise<void> => {
    setImportingIds((prev) => new Set(prev).add(ml.myListUrl));
    try {
      await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
      reloadMylists();
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(ml.myListUrl);
        return next;
      });
    }
  };

  const handleImportAll = async (): Promise<void> => {
    if (!accountMylists) return;
    const registeredSet = new Set(mylists.map((m) => m.myListUrl));
    for (const ml of accountMylists) {
      if (!registeredSet.has(ml.myListUrl)) {
        await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
      }
    }
    reloadMylists();
  };

  return {
    accountFetching,
    accountError,
    accountMylists,
    setAccountMylists,
    importingIds,
    handleFetchAccount,
    handleImportOne,
    handleImportAll
  };
}
