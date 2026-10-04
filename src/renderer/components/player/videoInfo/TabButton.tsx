/** 動画情報パネルのタブボタン */
export function TabButton({
  label,
  active,
  onClick,
  tooltip
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tooltip?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={[
        'shrink-0 text-xs py-1.5 px-2 border-b-2 transition-colors truncate',
        active
          ? 'border-nndd-accent text-nndd-text font-bold'
          : 'border-transparent text-nndd-subtext hover:text-nndd-text'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
