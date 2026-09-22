import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownPlacement } from '@renderer/hooks/useDropdownPlacement';

export interface ControlBarSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface ControlBarSelectProps<T extends string> {
  value: T;
  options: ControlBarSelectOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  className?: string;
}

/**
 * ネイティブ <select> 代替のドロップダウン。
 * 全画面時などコントロールバーが画面下端にある場合、展開方向をJS側で
 * 上下自動判定する (ネイティブ select は展開方向を制御できず、Linux版
 * Electronの全画面時に選択肢が画面外へはみ出す問題があった)。
 */
export function ControlBarSelect<T extends string>({
  value,
  options,
  onChange,
  title,
  className
}: ControlBarSelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { top, left, maxHeight } = useDropdownPlacement(buttonRef, open, options.length);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        className={[
          'bg-nndd-border text-white text-sm rounded px-1 py-0.5 cursor-pointer',
          className ?? ''
        ].join(' ')}
      >
        {current?.label ?? value} ▾
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-nndd-panel border border-nndd-border rounded shadow-lg py-1 text-base z-[9999] overflow-y-auto no-scrollbar"
            style={{ top, left, maxHeight }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={[
                  'block w-full text-left px-3 py-1.5 whitespace-nowrap hover:bg-nndd-accent hover:text-white',
                  o.value === value ? 'text-nndd-accent' : 'text-nndd-text'
                ].join(' ')}
              >
                {o.label}
              </button>
            ))}
          </div>,
          // 全画面中は document.body 直下だと fullscreen 要素 (containerRef) の下に
          // 隠れてクリックできなくなるため、fullscreen 要素の内側にポータルする。
          document.fullscreenElement ?? document.body
        )}
    </>
  );
}
