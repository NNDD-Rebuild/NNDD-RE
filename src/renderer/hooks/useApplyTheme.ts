import { useEffect } from 'react';

/** 設定 `ui.theme` が light なら、ウィンドウに light クラスを付ける */
export function useApplyTheme(): void {
  useEffect(() => {
    window.nndd
      .invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => {
        if (v === 'light') document.documentElement.classList.add('light');
      })
      .catch(() => {});
  }, []);
}
