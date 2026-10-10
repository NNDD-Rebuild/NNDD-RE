/** 匿名統計の同意状態 (TELEMETRY_GET_STATE の返り値) */
export interface TelemetryState {
  consent: 'unknown' | 'granted' | 'denied';
  /** 同意ダイアログを出すべきか (未回答、または同意後に送信項目が増えたとき) */
  needsConsent: boolean;
}

/** renderer から送れる統計イベント (TELEMETRY_TRACK)。main 側でも同じ内容を検証する */
export type TelemetryRendererEvent =
  | { name: 'tab_view'; props: { tab: string; changed: boolean } }
  | { name: 'settings_subtab'; props: { sub: string; changed: boolean } }
  | { name: 'quality_change'; props: { kind: 'video' | 'live' } }
  | { name: 'jump_command'; props: { result: 'accept' | 'reject' } };
