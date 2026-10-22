/** ニコニコのメンテナンス状態。動画系 (www / nvapi) と生放送系 (live / live2 / cas) は別々に判定する */
export interface MaintenanceState {
  video: boolean;
  live: boolean;
}

export type MaintenanceKind = keyof MaintenanceState;
