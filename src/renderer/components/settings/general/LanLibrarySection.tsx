import { useEffect, useState } from 'react';
import { Section } from '../common';

/** 設定 > 全般 > LANライブラリ (リモートNNDD参照) */
export function LanLibrarySection(): JSX.Element {
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteAddress, setRemoteAddress] = useState('');
  const [remotePort, setRemotePort] = useState(12300);

  useEffect(() => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'remoteNndd.enabled')
      .then((v) => setRemoteEnabled(v === true))
      .catch(() => {});
    window.nndd
      .invoke<string>(window.nndd.channels.CONFIG_GET, 'remoteNndd.address')
      .then((v) => setRemoteAddress(v ?? ''))
      .catch(() => {});
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'remoteNndd.port')
      .then((v) => { if (typeof v === 'number') setRemotePort(v); })
      .catch(() => {});
  }, []);

  return (
    <Section title="LANライブラリ (リモートNNDD参照)">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={remoteEnabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setRemoteEnabled(v);
            await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.enabled', v);
          }}
        />
        リモートNNDDのライブラリを参照する
      </label>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-nndd-subtext w-24 shrink-0">IPアドレス</span>
        <input
          type="text"
          placeholder="192.168.x.x"
          value={remoteAddress}
          onChange={(e) => setRemoteAddress(e.target.value)}
          onBlur={async () => {
            await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.address', remoteAddress);
          }}
          className="flex-1 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-nndd-subtext w-24 shrink-0">ポート</span>
        <input
          type="number"
          min={1024}
          max={65535}
          value={remotePort}
          onChange={(e) => setRemotePort(Number(e.target.value))}
          onBlur={async () => {
            await window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'remoteNndd.port', remotePort);
          }}
          className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
        <span className="text-xs text-nndd-subtext">(本家NNDDデフォルト: 12300)</span>
      </div>
      <p className="text-xs text-nndd-subtext mt-2">
        同じLAN内の本家NNDDまたはNNDD-REのライブラリを「LANライブラリ」タブで閲覧・再生できます。
        本家NNDDではサーバー設定でポート12300・動画情報共有を有効にしてください。
      </p>
    </Section>
  );
}
