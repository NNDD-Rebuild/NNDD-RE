import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * 設定値の読み書きフック。
 * 元: src/org/mineap/util/config/ConfigManager.as の薄いラッパ。
 *
 * key は dot-notation ("player.volume" 等) も指定可能。
 */
export function useConfig<T>(
  key: string,
  defaultValue: T
): [T, (next: T) => Promise<void>, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.nndd
      .invoke<T>(window.nndd.channels.CONFIG_GET, key)
      .then((v) => {
        if (cancelled) return;
        if (v !== undefined && v !== null) setValue(v);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const saveSeqRef = useRef(0);

  // 呼び出し側はほぼ await しないため、保存失敗はここで通知して reject させない。
  const update = useCallback(
    async (next: T): Promise<void> => {
      const seq = ++saveSeqRef.current;
      setValue(next);
      try {
        await window.nndd.invoke(window.nndd.channels.CONFIG_SET, key, next);
      } catch (e) {
        console.error(`[useConfig] 設定の保存に失敗しました: ${key}`, e);
        useAppStore.getState().showToast('設定の保存に失敗しました');
        if (seq !== saveSeqRef.current) return;
        // 画面の値を実際に保存されている値に戻す (より新しい保存が始まっていれば触らない)
        const stored = await window.nndd
          .invoke<T>(window.nndd.channels.CONFIG_GET, key)
          .catch(() => undefined);
        if (seq === saveSeqRef.current && stored !== undefined && stored !== null) setValue(stored);
      }
    },
    [key]
  );

  return [value, update, loading];
}
