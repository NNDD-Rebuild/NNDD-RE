import { useConfig } from '@renderer/hooks/useConfig';
import { CheckRow, CommitInput, Hint, NumberCommitInput, Row, Section } from '../common';

/** 設定 > 全般 > LANライブラリ (リモートNNDD参照) */
export function LanLibrarySection(): JSX.Element {
  const [remoteEnabled, setRemoteEnabled] = useConfig<boolean>('remoteNndd.enabled', false);
  const [remoteAddress, setRemoteAddress] = useConfig<string>('remoteNndd.address', '');
  const [remotePort, setRemotePort] = useConfig<number>('remoteNndd.port', 12300);

  return (
    <Section title="LANライブラリ (リモートNNDD参照)">
      <CheckRow
        checked={remoteEnabled}
        onChange={setRemoteEnabled}
        label="リモートNNDDのライブラリを参照する"
      />
      <Row label="IPアドレス">
        <CommitInput
          placeholder="192.168.x.x"
          value={remoteAddress}
          onCommit={setRemoteAddress}
          className="flex-1"
        />
      </Row>
      <Row label="ポート">
        <NumberCommitInput value={remotePort} min={1024} max={65535} onCommit={setRemotePort} />
        <Hint>(本家NNDDデフォルト: 12300)</Hint>
      </Row>
      <Hint>
        同じLAN内の本家NNDDまたはNNDD-REのライブラリを「LANライブラリ」タブで閲覧・再生できます。
        本家NNDDではサーバー設定でポート12300・動画情報共有を有効にしてください。
      </Hint>
    </Section>
  );
}
