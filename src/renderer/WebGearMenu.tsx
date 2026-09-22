import { useEffect, useState } from 'react';

/**
 * ブラウザ版プレイヤー (モバイル縦画面) 専用の⚙️メニュー。
 *
 * 「フォルダ連続再生」チェックボックスと「ミュート」ボタンは PlayerApp / VideoController が
 * 描画する本物の要素をそのまま使う (機能を二重実装しない)。このコンポーネントは
 * <html> に web-gear-open クラスを付け外しするだけで、実際の表示位置の切替は web.css が行う。
 */
export function WebGearMenu(): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('web-gear-open', open);
  }, [open]);

  // アンマウント時に消し忘れないようにする
  useEffect(() => () => document.documentElement.classList.remove('web-gear-open'), []);

  // パネル外 (ミュートボタン・フォルダ連続再生チェックボックス以外) をタップしたら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement;
      if (
        t.closest('.web-gear-btn') ||
        t.closest('[title="ミュート"]') ||
        t.closest('[title="ミュート解除"]') ||
        t.closest('[class*="bg-black/80"]')
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <button
      type="button"
      className="web-gear-btn"
      onClick={() => setOpen((v) => !v)}
      title="その他の操作"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        zIndex: 46,
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: open ? '#3b82f6' : 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 18,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      ⚙️
    </button>
  );
}
