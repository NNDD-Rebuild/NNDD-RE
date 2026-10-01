import { useState } from 'react';
import { IpcChannel } from '@shared/types';

/**
 * ライブラリ左ペインのフォルダ追加フォーム。
 * 入力欄の表示状態・入力値はタグ/フォルダ切替や LAN 選択で入力欄が隠れても保持する (LibraryView の state として持つ)。
 */
export function useLibraryFolderCreate(reload: () => void) {
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);

  const handleFolderCreate = async (): Promise<void> => {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderCreateError(null);
    try {
      await window.nndd.invoke(IpcChannel.LIBRARY_FOLDER_CREATE, name);
      setNewFolderName('');
      setShowFolderInput(false);
      reload();
    } catch (e) {
      setFolderCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    showFolderInput,
    setShowFolderInput,
    newFolderName,
    setNewFolderName,
    folderCreateError,
    handleFolderCreate
  };
}
