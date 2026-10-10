import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, Section, TextInput } from '../common';

/** 設定 > 全般 > 動画の保存先 */
export function LibraryRootSection(): JSX.Element {
  const [libraryRoot, setLibraryRoot] = useConfig<string>('libraryRoot', '');

  const chooseDir = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      window.nndd.channels.SYS_CHOOSE_DIRECTORY,
      libraryRoot
    );
    if (dir) await setLibraryRoot(dir);
  };

  const openLibrary = async (): Promise<void> => {
    if (libraryRoot) {
      await window.nndd.invoke(
        window.nndd.channels.SYS_OPEN_PATH,
        libraryRoot
      );
    }
  };

  return (
    <Section title="動画の保存先">
      <div className="flex items-center gap-2">
        <TextInput
          value={libraryRoot}
          readOnly
          className="flex-1"
          placeholder="(デフォルト: Documents/NNDD-RE/library/Downloads)"
        />
        <Btn onClick={chooseDir}>参照...</Btn>
        <Btn onClick={openLibrary} disabled={!libraryRoot}>
          開く
        </Btn>
        <Btn onClick={() => void setLibraryRoot('')} disabled={!libraryRoot}>
          デフォルトに戻す
        </Btn>
      </div>
    </Section>
  );
}
