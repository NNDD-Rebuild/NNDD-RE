import type { TelemetryRendererEvent } from '@shared/types';

/** 匿名統計のイベントを main に渡す。同意していなければ main 側で捨てられる (失敗は無視) */
export function trackRenderer(ev: TelemetryRendererEvent): void {
  window.nndd.invoke(window.nndd.channels.TELEMETRY_TRACK, ev).catch(() => {});
}
