import { useEffect, useState } from 'react';

/**
 * ブラウザ版プレイヤー専用の「ライブラリへ戻る」ボタン。
 * 操作が止まって数秒で薄くなり、マウス/タッチ操作で再表示される。
 */
export function WebBackButton({ onBack }: { onBack: () => void }): JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer: number | undefined;
    const show = (): void => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 3000);
    };
    show();
    window.addEventListener('mousemove', show);
    window.addEventListener('touchstart', show, { passive: true });
    window.addEventListener('keydown', show);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', show);
      window.removeEventListener('touchstart', show);
      window.removeEventListener('keydown', show);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onBack}
      style={{
        position: 'fixed',
        top: 'max(10px, env(safe-area-inset-top))',
        left: 10,
        zIndex: 2147483000,
        padding: '8px 16px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 17,
        border: 'none',
        cursor: 'pointer',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.3s'
      }}
    >
      ← ライブラリ
    </button>
  );
}
