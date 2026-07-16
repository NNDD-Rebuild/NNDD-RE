import { useCallback, useEffect, useState } from 'react';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    async (next: T): Promise<void> => {
      setValue(next);
      await window.nndd.invoke(window.nndd.channels.CONFIG_SET, key, next);
    },
    [key]
  );

  return [value, update, loading];
}
