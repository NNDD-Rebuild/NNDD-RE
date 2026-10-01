import { useConfig } from '@renderer/hooks/useConfig';
import { Section, Btn } from '../common';

/** 設定 > 全般 > システムトレイ */
export function TraySection(): JSX.Element {
  const [trayEnabled, setTrayEnabled] = useConfig<boolean>('tray.enabled', true);
  const [minimizeToTray, setMinimizeToTray] = useConfig<boolean>(
    'tray.minimizeToTray',
    true
  );

  return (
    <Section title="システムトレイ">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={trayEnabled}
          onChange={(e) => setTrayEnabled(e.target.checked)}
        />
        トレイアイコンを表示
      </label>
      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={minimizeToTray}
          onChange={(e) => setMinimizeToTray(e.target.checked)}
        />
        ウィンドウを閉じたらトレイに最小化
        <span className="text-xs text-nndd-subtext ml-1">(DLが続行できます)</span>
      </label>
    </Section>
  );
}

/** 設定 > 全般 > ウィンドウの大きさ・位置をリセット */
export function WindowResetSection(): JSX.Element {
  return (
    <Section title="ウィンドウの大きさ・位置をリセットする">
      <Btn
        onClick={async () => {
          await window.nndd.invoke(
            window.nndd.channels.CONFIG_SET,
            'ui.window',
            { width: 1280, height: 800, maximized: false }
          );
        }}
      >
        リセット
      </Btn>
    </Section>
  );
}
