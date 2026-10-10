import { useEffect, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from 'react';

/**
 * 設定画面の共通部品。
 * 見出し・行・チェック・ラジオ・入力・ボタン・説明文はここに集約し、各タブで個別に Tailwind を書かない。
 */

/** タブ最上部のページ見出し (h2) と説明文 */
export function PageTitle({
  title,
  children
}: {
  title: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold">{title}</h2>
      {children && <Hint className="mt-1">{children}</Hint>}
    </div>
  );
}

/** タブ全体の外枠 */
export function SettingsPage({ children }: { children: ReactNode }): JSX.Element {
  return <div className="p-4 max-w-3xl">{children}</div>;
}

/** 設定画面の見出し付きブロック */
export function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5">
      <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">
        {title}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

/** 枠付きパネル (ツール単位など、Section より独立性の高いまとまり) */
export function Card({
  title,
  right,
  children
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="bg-nndd-panel border border-nndd-border rounded p-4 mb-4 space-y-3">
      {(title || right) && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** 補足説明文 */
export function Hint({
  children,
  className = ''
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <p className={`text-xs text-nndd-subtext ${className}`}>{children}</p>;
}

/** 状態の色付きテキスト */
export function StatusText({
  kind,
  children
}: {
  kind: 'ok' | 'error' | 'warn';
  children: ReactNode;
}): JSX.Element {
  const color =
    kind === 'ok' ? 'text-green-600' : kind === 'error' ? 'text-red-500' : 'text-yellow-600';
  return <span className={`text-xs ${color}`}>{children}</span>;
}

/** ラベル列 + 操作列の行。hint は操作の下に表示する */
export function Row({
  label,
  hint,
  children
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start mb-2">
      <div className="w-56 shrink-0 pt-1 text-sm">{label}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2 min-h-[28px]">{children}</div>
        {hint && <Hint>{hint}</Hint>}
      </div>
    </div>
  );
}

/** チェックボックス 1 行 (説明文は下に表示する) */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="mb-2">
      <label
        className={`flex items-center gap-2 text-sm select-none ${
          disabled ? 'opacity-50' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && <Hint className="pl-6">{hint}</Hint>}
    </div>
  );
}

export type RadioOption<T extends string | number> = {
  value: T;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  /** この選択肢に属するサブ設定。選択肢の直下にインデント+左線付きで表示する */
  children?: ReactNode;
};

/** ラジオグループ。direction=row は横並び、column は説明文付きの縦並び */
export function RadioGroup<T extends string | number>({
  name,
  value,
  onChange,
  options,
  direction = 'row'
}: {
  name: string;
  value: T;
  onChange: (next: T) => void;
  options: RadioOption<T>[];
  direction?: 'row' | 'column';
}): JSX.Element {
  return (
    <div className={direction === 'row' ? 'flex flex-wrap gap-4 text-sm' : 'flex flex-col gap-1 text-sm'}>
      {options.map((o) => (
        <div key={String(o.value)}>
          <label
            className={`flex items-center gap-1.5 select-none ${
              o.disabled ? 'opacity-50' : 'cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
          {o.hint && <Hint className="pl-6">{o.hint}</Hint>}
          {o.children && (
            <div className="ml-6 mt-2 border-l border-nndd-border pl-3">{o.children}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const inputClass =
  'bg-nndd-bg border border-nndd-border rounded px-2 py-1 text-sm disabled:opacity-50';

/** セレクトボックス */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

/** ボタン型の選択肢 (プリセット選択用)。選択中は強調表示する */
export function ButtonGroup<T extends string | number>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Btn
          key={String(o.value)}
          variant={value === o.value ? 'primary' : 'default'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Btn>
      ))}
    </div>
  );
}

/**
 * スライダー。ドラッグ中は手元の値だけ更新し、離した時 / キー操作後に onCommit を呼ぶ
 * (ドラッグ中に設定保存の IPC を連打しない)。
 */
export function Slider({
  value,
  onCommit,
  min,
  max,
  step,
  format
}: {
  value: number;
  onCommit: (next: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-64"
      />
      {format && <span className="text-xs text-nndd-subtext w-16">{format(draft)}</span>}
    </>
  );
}

/** テキスト入力 (入力のたびに onChange が走る。設定保存には CommitInput を使う) */
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input type="text" {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

/**
 * 設定保存用のテキスト入力。入力中は手元の下書きだけを更新し、
 * フォーカスが外れた時 / Enter で onCommit を呼ぶ (途中の値を保存しない)。
 * 値が変わらなければ onCommit は呼ばない。
 */
export function CommitInput({
  value,
  onCommit,
  className = '',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'> & {
  value: string;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      {...rest}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`${inputClass} ${className}`}
    />
  );
}

/**
 * 設定保存用の数値入力。確定 (blur / Enter) 時に min / max で丸めてから onCommit を呼ぶ。
 * 空欄・数値でない入力は破棄して元の値に戻す。
 */
export function NumberCommitInput({
  value,
  onCommit,
  min,
  max,
  className = 'w-24',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'> & {
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`${inputClass} ${className}`}
    />
  );
}

type BtnVariant = 'default' | 'primary' | 'danger';

const btnVariantClass: Record<BtnVariant, string> = {
  default: 'bg-nndd-border hover:bg-nndd-accent',
  primary: 'bg-nndd-accent hover:opacity-90 text-white',
  danger: 'bg-nndd-border hover:bg-red-600 hover:text-white text-red-500'
};

/** 設定画面の小ボタン (disabled 時は半透明) */
export function Btn({
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }): JSX.Element {
  return (
    <button
      {...props}
      className={[
        'text-xs px-3 py-1 rounded disabled:opacity-50',
        btnVariantClass[variant],
        props.className ?? ''
      ].join(' ')}
    />
  );
}
