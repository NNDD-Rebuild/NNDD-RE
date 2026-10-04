import type { ButtonHTMLAttributes, ReactNode } from 'react';

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

/** 設定画面の小ボタン (disabled 時は半透明) */
export function Btn(props: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...props}
      className={[
        'text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded disabled:opacity-50',
        props.className ?? ''
      ].join(' ')}
    />
  );
}
