import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, CheckRow, CommitInput, Hint, NumberCommitInput, Row, Section, TextInput } from '../common';

/** 設定 > 全般 > LANライブラリ (リモートNNDD参照) */
export function LanLibrarySection(): JSX.Element {
  const [remoteEnabled, setRemoteEnabled] = useConfig<boolean>('remoteNndd.enabled', false);
  const [remoteAddress, setRemoteAddress] = useConfig<string>('remoteNndd.address', '');
  const [remotePort, setRemotePort] = useConfig<number>('remoteNndd.port', 12300);
  // 接続先のアクセストークンは設定 (Gist バックアップの同期対象) ではなく、この端末の暗号化ストレージに保存する
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    window.nndd
      .invoke<{ hasToken: boolean }>(window.nndd.channels.LAN_TOKEN_STATUS)
      .then((r) => setHasToken(r.hasToken))
      .catch(() => {});
  }, []);

  const saveToken = async (value: string): Promise<void> => {
    const r = await window.nndd.invoke<{ hasToken: boolean }>(window.nndd.channels.LAN_TOKEN_SET, value);
    setHasToken(r.hasToken);
    setTokenInput('');
  };

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
      <Row
        label="アクセストークン"
        hint="接続先の NNDD-RE が「アクセストークンを要求する」を有効にしている場合のみ入力します。この端末の暗号化ストレージに保存され、設定のバックアップには含まれません。"
      >
        <TextInput
          type="password"
          value={tokenInput}
          placeholder={hasToken ? '設定済み (変更する場合のみ入力)' : '未設定'}
          onChange={(e) => setTokenInput(e.target.value)}
          className="flex-1"
        />
        <Btn disabled={!tokenInput.trim()} onClick={() => void saveToken(tokenInput)}>保存</Btn>
        {hasToken && <Btn onClick={() => void saveToken('')}>削除</Btn>}
      </Row>
      <Hint>
        同じLAN内の本家NNDDまたはNNDD-REのライブラリを「LANライブラリ」タブで閲覧・再生できます。
        本家NNDDではサーバー設定でポート12300・動画情報共有を有効にしてください。
      </Hint>
    </Section>
  );
}
