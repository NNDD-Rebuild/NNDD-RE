import { useEffect, useRef, useState } from 'react';

interface Props {
  /** バーの左端 (番組の基準時刻, unix ms)。右端は現在時刻 */
  beginMs: number;
  /** 今映っている映像の時刻 (unix ms) */
  getPlayingMs: () => number;
  /** バーを操作して離した位置の時刻 (unix ms) へ移動を要求する */
  onSeekTo: (ms: number) => void;
}

/**
 * 低遅延のライブ視聴中のシークバー。低遅延の HLS には巻き戻せる範囲がほとんど無いので、
 * 番組の開始〜現在を範囲とする仮のバーとして描く。離した位置への移動は onSeekTo に任せる
 * (巻き戻しできる追っかけ再生へ切り替えてから移動する)。
 */
export function LiveRewindBar({ beginMs, getPlayingMs, onSeekTo }: Props): JSX.Element {
  const barRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [dragPct, setDragPct] = useState<number | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);

  const nowMs = Date.now();
  const lenMs = Math.max(1, nowMs - beginMs);
  const pct = dragPct ?? Math.max(0, Math.min(1, (getPlayingMs() - beginMs) / lenMs));

  const pctAt = (e: React.PointerEvent): number => {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  return (
    <div
      ref={barRef}
      className="flex-1 relative h-5 cursor-pointer flex items-center group"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragPct(pctAt(e));
      }}
      onPointerMove={(e) => {
        setHoverPct(pctAt(e));
        if (dragPct !== null) setDragPct(pctAt(e));
      }}
      onPointerUp={(e) => {
        if (dragPct === null) return;
        const p = pctAt(e);
        setDragPct(null);
        onSeekTo(beginMs + p * (Date.now() - beginMs));
      }}
      onPointerLeave={() => setHoverPct(null)}
      title="ここから左へ動かすと追っかけ再生に切り替えて巻き戻します"
    >
      <div className="w-full h-1.5 bg-nndd-border/50 rounded-full relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-nndd-accent rounded-full" style={{ width: `${pct * 100}%` }} />
      </div>
      <div
        className="absolute w-3 h-3 bg-nndd-text rounded-full shadow pointer-events-none -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ left: `${pct * 100}%` }}
      />
      {hoverPct !== null && (
        <div
          className="absolute bottom-6 -translate-x-1/2 bg-black/80 text-white text-[10px] font-mono px-1 rounded pointer-events-none"
          style={{ left: `${hoverPct * 100}%` }}
        >
          {formatBehind((1 - hoverPct) * lenMs)}
        </div>
      )}
    </div>
  );
}

/** 現在から遅れた時間を -h:mm:ss / -m:ss で表す */
function formatBehind(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `-${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `-${m}:${String(s).padStart(2, '0')}`;
}
