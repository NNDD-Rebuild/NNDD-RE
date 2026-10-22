import { useEffect } from 'react';
import type { MaintenanceState } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * ニコニコのメンテナンス中に出す常時バナー。動画系と生放送系は別々に表示する。
 * 状態は main の MaintenanceMonitor が持ち、変化時に push される (復帰は main が定期確認して自動解除)。
 */
export function MaintenanceBanner(): JSX.Element | null {
  const maintenance = useAppStore((s) => s.maintenance);
  const setMaintenance = useAppStore((s) => s.setMaintenance);

  useEffect(() => {
    void window.nndd
      .invoke<MaintenanceState>(window.nndd.channels.MAINTENANCE_GET)
      .then(setMaintenance)
      .catch(() => undefined);
    return window.nndd.on(window.nndd.channels.MAINTENANCE_CHANGED, (state: unknown) =>
      setMaintenance(state as MaintenanceState)
    );
  }, [setMaintenance]);

  const targets: { label: string; url: string }[] = [];
  if (maintenance.video) targets.push({ label: 'ニコニコ動画', url: 'https://www.nicovideo.jp/' });
  if (maintenance.live) targets.push({ label: 'ニコニコ生放送', url: 'https://live.nicovideo.jp/' });
  if (targets.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-amber-600 text-white text-xs border-b border-amber-700">
      <span>
        {targets.map((t) => t.label).join('・')}はメンテナンス中です。終了すると自動で解除されます。
      </span>
      {targets.map((t) => (
        <button
          key={t.url}
          onClick={() => void window.nndd.invoke(window.nndd.channels.SYS_OPEN_IN_BROWSER, t.url)}
          className="px-2 py-0.5 rounded bg-amber-800 hover:bg-amber-900"
        >
          {targets.length > 1 ? `${t.label}のメンテナンスページを開く` : 'メンテナンスページを開く'}
        </button>
      ))}
    </div>
  );
}
