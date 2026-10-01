import { useEffect, useState } from 'react';
import { IpcChannel } from '@shared/types';
import { Section, Btn } from '../common';

interface CacheInfo { sizeBytes: number; fileCount: number; dir: string }

/** 設定 > 全般 > 画像キャッシュ (サムネイル・アイコン) */
export function ImageCacheSection(): JSX.Element {
  const [imgCacheEnabled, setImgCacheEnabled] = useState(true);
  const [imgCacheMaxSizeMb, setImgCacheMaxSizeMb] = useState(1000);
  const [imgCacheInfo, setImgCacheInfo] = useState<CacheInfo | null>(null);
  const [imgCacheBusy, setImgCacheBusy] = useState(false);

  const refreshImgCacheInfo = (): void => {
    window.nndd
      .invoke<CacheInfo>(IpcChannel.IMAGE_CACHE_INFO)
      .then(setImgCacheInfo)
      .catch(() => {});
  };

  useEffect(() => {
    window.nndd
      .invoke<boolean>(window.nndd.channels.CONFIG_GET, 'imageCache.enabled')
      .then((v) => setImgCacheEnabled(v !== false))
      .catch(() => {});
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'imageCache.maxSizeMb')
      .then((v) => { if (typeof v === 'number') setImgCacheMaxSizeMb(v); })
      .catch(() => {});
    refreshImgCacheInfo();
  }, []);

  return (
    <Section title="画像キャッシュ (サムネイル・アイコン)">
      <div className="flex items-center gap-3 mb-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={imgCacheEnabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setImgCacheEnabled(v);
              await window.nndd.invoke(IpcChannel.IMAGE_CACHE_ENABLED_SET, v);
            }}
          />
          キャッシュを有効にする
        </label>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-nndd-subtext w-20 shrink-0">上限サイズ</span>
        <input
          type="number"
          min={0}
          step={100}
          value={imgCacheMaxSizeMb}
          onChange={async (e) => {
            const v = Math.max(0, Number(e.target.value));
            setImgCacheMaxSizeMb(v);
            await window.nndd.invoke(IpcChannel.IMAGE_CACHE_MAX_SIZE_SET, v);
          }}
          className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
        />
        <span className="text-xs text-nndd-subtext">MB (0 = 無制限)</span>
      </div>
      {imgCacheInfo && (
        <div className="text-xs text-nndd-subtext mb-2">
          {imgCacheInfo.fileCount} ファイル /{' '}
          {(imgCacheInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB
          <span className="ml-2 opacity-60 truncate" title={imgCacheInfo.dir}>
            ({imgCacheInfo.dir})
          </span>
        </div>
      )}
      <div className="flex gap-2">
        <Btn onClick={refreshImgCacheInfo}>更新</Btn>
        <Btn
          disabled={imgCacheBusy}
          onClick={async () => {
            if (!confirm('画像キャッシュをすべて削除しますか？')) return;
            setImgCacheBusy(true);
            try {
              await window.nndd.invoke(IpcChannel.IMAGE_CACHE_CLEAR);
              refreshImgCacheInfo();
            } finally {
              setImgCacheBusy(false);
            }
          }}
        >
          {imgCacheBusy ? '削除中…' : 'キャッシュを削除'}
        </Btn>
      </div>
      <p className="text-xs text-nndd-subtext mt-2">
        動画再生時に取得したサムネイルとユーザーアイコンをローカルに保存します。
        次回同じ動画を開く際にオフラインでも表示できます。
      </p>
    </Section>
  );
}
