import { useState } from 'react';
import type { MyList, RssTypeValue } from '@shared/types';
import { IpcChannel, RssType } from '@shared/types';
import { parseMylistSource } from '@shared/utils/parseMylistUrl';

/**
 * マイリスト追加フォーム (URL から種別を自動判定)。
 * URL 欄の確定時はプレビューとして fetchItems で一時表示し、追加ボタンで DB に登録する。
 */
export function useMylistAddForm({
  fetchItems,
  reloadMylists
}: {
  fetchItems: (ml: MyList) => Promise<void>;
  reloadMylists: () => void;
}) {
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RssTypeValue>(RssType.MY_LIST);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const url = newUrl.trim();
    if (!url) return;
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
    setNewUrl('');
    setNewName('');
    setUrlError(null);
    reloadMylists();
  };

  return {
    newUrl,
    setNewUrl,
    newName,
    setNewName,
    newType,
    urlError,
    previewLoading,
    handleUrlPreview,
    handleAdd
  };
}
