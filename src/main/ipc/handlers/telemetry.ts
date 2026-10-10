import { ipcMain } from 'electron';
import { IpcChannel, type TelemetryRendererEvent } from '@shared/types';
import {
  getTelemetryState,
  resetTelemetryInstallId,
  setTelemetryConsent,
  trackFromRenderer
} from '../../telemetry/Telemetry';

/** 匿名統計 (TELEMETRY_*)。同意状態の取得・変更と、renderer 発のイベント受け口 */
export function registerTelemetryHandlers(): void {
  ipcMain.handle(IpcChannel.TELEMETRY_GET_STATE, () => getTelemetryState());

  ipcMain.handle(IpcChannel.TELEMETRY_SET_CONSENT, (_e, granted: unknown) =>
    setTelemetryConsent(granted === true)
  );

  ipcMain.handle(IpcChannel.TELEMETRY_RESET_ID, () => {
    resetTelemetryInstallId();
  });

  ipcMain.handle(IpcChannel.TELEMETRY_TRACK, (_e, ev: TelemetryRendererEvent) => {
    trackFromRenderer(ev);
  });
}
