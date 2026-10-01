import { useEffect, useState } from 'react';
import { Section } from '../common';

interface DeveloperSectionProps {
  onDeveloperModeChange?: (enabled: boolean) => void;
}

/** 設定 > 全般 > 開発者オプション */
export function DeveloperSection({ onDeveloperModeChange }: DeveloperSectionProps): JSX.Element {
  const [developerEnabled, setDeveloperEnabled] = useState(false);

  useEffect(() => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'developer.enabled')
      .then((v) => setDeveloperEnabled(v !== false))
      .catch(() => {});
  }, []);

  return (
    <Section title="開発者オプション">
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={developerEnabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setDeveloperEnabled(v);
            await window.nndd.invoke(
              window.nndd.channels.CONFIG_SET,
              'developer.enabled',
              v
            );
            onDeveloperModeChange?.(v);
          }}
        />
        <span className="font-bold">開発者モードを有効にする</span>
      </label>
      <p className="text-xs text-nndd-subtext mt-2">
        有効にすると、設定画面に「デバッグ」タブが表示され、
        API生データの保存先選択やダンプ対象の設定ができるようになります。
      </p>
    </Section>
  );
}
