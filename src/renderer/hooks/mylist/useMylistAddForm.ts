import { useState } from 'react';
import type { MyList, RssTypeValue } from '@shared/types';
import { IpcChannel, RssType } from '@shared/types';
import { parseMylistSource } from '@shared/utils/parseMylistUrl';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import { useMyListHistory } from '../useInputHistory';

/**
 * マイリスト追加フォーム (URL から種別を自動判定)。
 * URL 欄の確定時はプレビューとして fetchItems で一時表示し、追加ボタンで DB に登録する。
 */
export function useMylistAddForm({
  fetchItems,
  reloadMylists,
  isLoggedIn,
  onCreated
}: {
  fetchItems: (ml: MyList) => Promise<void>;
  reloadMylists: () => void;
  isLoggedIn: boolean;
  /** ニコニコに新規作成したマイリスト (RE にも登録済み) */
  onCreated: (ml: MyList) => void;
}) {
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RssTypeValue>(RssType.MY_LIST);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // URL なしで表示名だけ入れて追加したときの「新規作成しますか?」確認 (公開/非公開の選択つき)
  const [createPending, setCreatePending] = useState(false);
  const [createPublic, setCreatePublic] = useState(false);
  const [creating, setCreating] = useState(false);
  const { history: urlHistory, addHistory: addUrlHistory } = useMyListHistory();

  /** URL入力欄からフォーカスが外れた/Enterされた時: 種別自動判定してプレビュー表示 */
  const handleUrlPreview = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) { setUrlError(null); return; }
    const parsed = parseMylistSource(url);
    if (!parsed) {
      setUrlError('マイリスト/チャンネル/ユーザー/シリーズのURLまたはIDを認識できませんでした');
      return;
    }
    setUrlError(null);
    setNewType(parsed.type);
    setPreviewLoading(true);
    try {
      let name = newName.trim();
      if (!name) {
        const info = await window.nndd.invoke<{ name: string } | null>(
          IpcChannel.MYLIST_FETCH_INFO,
          { url: parsed.normalizedUrl, type: parsed.type }
        ).catch(() => null);
        if (info?.name) {
          name = info.name;
          setNewName(info.name);
        }
      }
      const tempMl: MyList = {
        myListUrl: parsed.normalizedUrl,
        myListName: name || parsed.normalizedUrl,
        type: parsed.type,
        isDir: false,
        unPlayVideoCount: 0,
        myListVideoIds: {},
      };
      await fetchItems(tempMl);
      void addUrlHistory({ name: tempMl.myListName, url: tempMl.myListUrl });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) {
      // URL なしで表示名だけ → ニコニコのアカウントに新規作成するか確認する
      if (!newName.trim()) return;
      if (!isLoggedIn) {
        setUrlError('ログインすると新しいマイリストを作成できます');
        return;
      }
      setUrlError(null);
      setCreatePublic(false);
      setCreatePending(true);
      return;
    }
    const parsed = parseMylistSource(url);
    if (!parsed) {
      setUrlError('マイリスト/チャンネル/ユーザー/シリーズのURLまたはIDを認識できませんでした');
      return;
    }
    let name = newName.trim();
    if (!name) {
      const info = await window.nndd.invoke<{ name: string } | null>(
        IpcChannel.MYLIST_FETCH_INFO,
        { url: parsed.normalizedUrl, type: parsed.type }
      ).catch(() => null);
      name = info?.name ?? parsed.normalizedUrl;
    }
    const ml: MyList = {
      myListUrl: parsed.normalizedUrl,
      myListName: name,
      type: parsed.type,
      isDir: false,
      unPlayVideoCount: 0,
      myListVideoIds: {},
    };
    await window.nndd.invoke(IpcChannel.MYLIST_ADD, ml);
    void addUrlHistory({ name: ml.myListName, url: ml.myListUrl });
    setNewUrl('');
    setNewName('');
    setUrlError(null);
    reloadMylists();
  };

  /** 確認パネルで「作成」: ニコニコに作成し、RE にも登録して開く */
  const handleConfirmCreate = async (): Promise<void> => {
    setCreating(true);
    try {
      const ml = await window.nndd.invoke<MyList>(IpcChannel.MYLIST_CREATE_SERVER, {
        name: newName.trim(),
        isPublic: createPublic
      });
      setCreatePending(false);
      setNewName('');
      setUrlError(null);
      reloadMylists();
      onCreated(ml);
    } catch (e) {
      setUrlError(`マイリストを作成できませんでした: ${toUserFriendlyErrorMessage(e)}`);
      setCreatePending(false);
    } finally {
      setCreating(false);
    }
  };

  return {
    createPending,
    createPublic,
    setCreatePublic,
    creating,
    handleConfirmCreate,
    handleCancelCreate: () => setCreatePending(false),
    newUrl,
    setNewUrl,
    newName,
    setNewName,
    newType,
    urlError,
    previewLoading,
    urlHistory,
    handleUrlPreview,
    handleAdd
  };
}
