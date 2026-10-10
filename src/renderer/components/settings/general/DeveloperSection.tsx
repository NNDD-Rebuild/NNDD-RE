import { useConfig } from '@renderer/hooks/useConfig';
import { CheckRow, Section } from '../common';

interface DeveloperSectionProps {
  onDeveloperModeChange?: (enabled: boolean) => void;
}

/** 設定 > 全般 > 開発者オプション */
export function DeveloperSection({ onDeveloperModeChange }: DeveloperSectionProps): JSX.Element {
  const [developerEnabled, setDeveloperEnabled] = useConfig<boolean>('developer.enabled', false);

  return (
    <Section title="開発者オプション">
      <CheckRow
        checked={developerEnabled}
        onChange={(v) => {
          void setDeveloperEnabled(v).then(() => onDeveloperModeChange?.(v));
        }}
        label={<span className="font-bold">開発者モードを有効にする</span>}
        hint="有効にすると、設定画面に「デバッグ」タブが表示され、API生データの保存先選択やダンプ対象の設定ができるようになります。"
      />
    </Section>
  );
}
