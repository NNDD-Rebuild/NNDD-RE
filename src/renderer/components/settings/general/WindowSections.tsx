import { useConfig } from '@renderer/hooks/useConfig';
import { Btn, CheckRow, Section } from '../common';

/** 設定 > 全般 > システムトレイ */
export function TraySection(): JSX.Element {
  const [trayEnabled, setTrayEnabled] = useConfig<boolean>('tray.enabled', true);
  const [minimizeToTray, setMinimizeToTray] = useConfig<boolean>(
    'tray.minimizeToTray',
    true
  );

  return (
    <Section title="システムトレイ">
      <CheckRow checked={trayEnabled} onChange={setTrayEnabled} label="トレイアイコンを表示" />
      <CheckRow
        checked={minimizeToTray}
        onChange={setMinimizeToTray}
        label="ウィンドウを閉じたらトレイに最小化"
        hint="DLが続行できます"
      />
    </Section>
  );
}

/** 設定 > 全般 > ウィンドウの大きさ・位置をリセット */
export function WindowResetSection(): JSX.Element {
  const [, setWindow] = useConfig<{ width: number; height: number; maximized: boolean }>('ui.window', {
    width: 1280,
    height: 800,
    maximized: false
  });

  return (
    <Section title="ウィンドウの大きさ・位置をリセットする">
      <Btn onClick={() => void setWindow({ width: 1280, height: 800, maximized: false })}>リセット</Btn>
    </Section>
  );
}
