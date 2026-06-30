import { useEffect, useRef, useState } from 'react';

export function ContinuousPlayButton({ disabled, onPlay }: {
  disabled: boolean;
  onPlay: (audioOnly: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => onPlay(false)}
        disabled={disabled}
        className="px-2 py-0.5 bg-nndd-accent text-white rounded-l hover:opacity-80 disabled:opacity-40 text-xs font-semibold"
      >▶ 連続再生</button>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="px-1 py-0.5 bg-nndd-accent text-white rounded-r border-l border-white/30 hover:opacity-80 disabled:opacity-40 text-xs"
      >▼</button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 flex flex-col bg-nndd-panel border border-nndd-border rounded shadow-lg z-50 text-xs whitespace-nowrap">
          <button
            onClick={() => { onPlay(false); setOpen(false); }}
            className="block w-full px-3 py-1 text-left hover:bg-nndd-border"
          >▶ 通常再生</button>
          <button
            onClick={() => { onPlay(true); setOpen(false); }}
            className="block w-full px-3 py-1 text-left hover:bg-nndd-border"
          >♪ 音声のみ</button>
        </div>
      )}
    </div>
  );
}
