import { useEffect, useState } from 'react';
import { Section, Btn } from '../common';

/** 設定 > 全般 > 動画の保存先 */
export function LibraryRootSection(): JSX.Element {
  const [libraryRoot, setLibraryRoot] = useState('');

  useEffect(() => {
    window.nndd
      .invoke<string>(window.nndd.channels.CONFIG_GET, 'libraryRoot')
      .then((v) => setLibraryRoot(v ?? ''));
  }, []);

  const chooseDir = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      window.nndd.channels.SYS_CHOOSE_DIRECTORY,
      libraryRoot
    );
    if (dir) {
      setLibraryRoot(dir);
      await window.nndd.invoke(
        window.nndd.channels.CONFIG_SET,
        'libraryRoot',
        dir
      );
    }
  };

  const openLibrary = async (): Promise<void> => {
    if (libraryRoot) {
      await window.nndd.invoke(
        window.nndd.channels.SYS_OPEN_PATH,
        libraryRoot
      );
    }
  };

  const resetToDefault = async (): Promise<void> => {
    setLibraryRoot('');
    await window.nndd.invoke(
      window.nndd.channels.CONFIG_SET,
      'libraryRoot',
      ''
    );
  };

  return (
    <Section title="動画の保存先">
      <div className="flex items-center gap-2">
        <input
          value={libraryRoot}
          readOnly
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          placeholder="(デフォルト: Documents/NNDD-RE/library/Downloads)"
        />
        <Btn onClick={chooseDir}>参照...</Btn>
        <Btn onClick={openLibrary} disabled={!libraryRoot}>
          開く
        </Btn>
        <Btn onClick={resetToDefault} disabled={!libraryRoot}>
          デフォルトに戻す
        </Btn>
      </div>
    </Section>
  );
}
