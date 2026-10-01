import { useEffect, useRef, useState } from 'react';

/** マイリストタブの一括 DL ▼ メニューの開閉状態。メニュー外の mousedown で閉じる */
export function useMylistBulkMenu() {
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bulkMenuOpen) return;
    const handler = (e: MouseEvent): void => {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(e.target as Node)) setBulkMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bulkMenuOpen]);

  return { bulkMenuOpen, setBulkMenuOpen, bulkMenuRef };
}
