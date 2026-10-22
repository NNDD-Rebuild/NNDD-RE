import type { ReactNode } from 'react';
import type { MaintenanceKind } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';

const LABEL: Record<MaintenanceKind, string> = {
  video: 'ニコニコ動画',
  live: 'ニコニコ生放送'
};

interface Props {
  /** どの系統の API 失敗か。該当系統がメンテ中ならエラー文の代わりにメンテ表示にする */
  kind: MaintenanceKind;
  /** サイズ・余白など (色は付けない) */
  className?: string;
  /** 通常時に赤字で出すエラー内容 */
  children: ReactNode;
}

/** API 取得失敗の表示。メンテナンス中は赤字エラーではなくメンテナンス表示に置き換える */
export function ErrorNotice({ kind, className = '', children }: Props): JSX.Element {
  const maintenance = useAppStore((s) => s.maintenance[kind]);
  if (maintenance) {
    return (
      <div className={`${className} text-amber-600 dark:text-amber-400`}>
        {LABEL[kind]}はメンテナンス中です。終了後に再度お試しください。
      </div>
    );
  }
  return <div className={`${className} text-red-500 dark:text-red-400`}>{children}</div>;
}
