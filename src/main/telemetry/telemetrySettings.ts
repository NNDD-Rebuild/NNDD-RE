import type { TelemetryProps } from './Telemetry';

/**
 * 匿名統計で送る設定項目の許可リスト。
 *
 * ここに載せた項目だけを送る (新しい設定キーが増えても自動では送られない)。
 * 値は bool / 固定選択肢 / 段階化した数値に限る。パス・URL・トークン・ホスト名・
 * 自由入力文字列・ID は載せないこと。
 */
type Spec =
  | 'bool'
  /** そのまま送る数値 (取りうる範囲が小さいものだけ) */
  | 'num'
  /** 固定の選択肢。候補に無い値は 'other' にする */
  | { enum: readonly (string | number)[] }
  /** しきい値で段階化する。例: [10, 50] → '<=10' / '<=50' / '>50' */
  | { buckets: readonly number[] };

type Entry = readonly [key: string, spec: Spec];

/** イベント名 (settings_xxx) → 項目。1 イベントは 15 項目前後に収める */
const GROUPS: Record<string, readonly Entry[]> = {
  settings_download: [
    ['useNativeVideoDownloader', 'bool'],
    ['downloadLiveToSubfolder', 'bool'],
    ['downloadEasyComments', 'bool'],
    ['downloadAllComments', 'bool'],
    ['skipCommentsOnAudioOnly', 'bool'],
    ['downloadMuxImplementation', { enum: ['ffmpeg', 'mediabunny'] }],
    ['maxConcurrentDownloads', 'num'],
    ['downloadRetryCount', 'num'],
    ['downloadRateLimitMbps', { buckets: [0, 10, 50, 100] }],
    ['downloadCooldownMs', { buckets: [0, 1000, 5000] }]
  ],
  settings_nico: [
    ['hideWatchHistory', 'bool'],
    ['hideSensitiveContents', 'bool'],
    ['sensitiveVideoHistoryPolicy', { enum: ['ask', 'allow', 'deny'] }],
    ['searchApi', { enum: ['snapshot', 'nvapi'] }],
    ['saveSearchHistory', 'bool'],
    ['saveMyListHistory', 'bool'],
    ['history.showWatchedBadge', 'bool'],
    ['externalPlayer.enabled', 'bool']
  ],
  settings_player: [
    ['player.streamingMode', { enum: ['hls', 'native', 'niconico'] }],
    ['player.defaultQuality', { enum: ['highest', 1080, 720, 480, 360] }],
    ['player.ngStrength', { enum: ['weak', 'medium', 'strong'] }],
    ['player.showComments', 'bool'],
    ['player.commentAntiAlias', 'bool'],
    ['player.commentBold', 'bool'],
    ['player.commentDropShadow', 'bool'],
    ['player.commentOutlineIntensity', { enum: ['light', 'normal'] }],
    ['player.keepPlaybackRate', 'bool'],
    ['player.volumeNormalize', 'bool'],
    ['player.repeat', 'bool'],
    ['player.niconicoInheritLogin', 'bool'],
    ['player.commentWindowAutoOpen', 'bool'],
    ['player.commentKeepCA', 'bool'],
    ['player.commentListDisplay', { enum: ['tab', 'window'] }]
  ],
  settings_player_ui: [
    ['player.openVideoLinkInPlayer', 'bool'],
    ['player.resumePlayback', 'bool'],
    ['player.controlsAlwaysVisible', 'bool'],
    ['player.autoNextFolder', 'bool'],
    ['player.controlUiSize', { enum: ['small', 'normal', 'large'] }],
    ['player.jumpCommand', { enum: ['ask', 'auto', 'off'] }]
  ],
  settings_live: [
    ['live.allowMultipleWindows', 'bool'],
    ['live.commentWindowOnTop', 'bool'],
    ['live.autoFollowMoveOrder', 'bool'],
    ['live.followNotify', 'bool'],
    ['live.followNotifyIntervalMin', { buckets: [1, 5, 10, 30] }],
    ['live.ncvEnabled', 'bool'],
    ['live.ncvTimeshift', 'bool'],
    ['live.commentListDisplay', { enum: ['side', 'window'] }]
  ],
  settings_ui: [
    ['ui.theme', { enum: ['dark', 'light'] }],
    ['ui.libraryViewMode', { enum: ['table', 'grid'] }],
    ['ui.contentViewMode', { enum: ['grid', 'list'] }],
    ['ui.librarySortCol', { enum: ['videoName', 'time', 'playCount', 'pubDate', 'creationDate'] }],
    ['ui.librarySortDir', { enum: ['asc', 'desc'] }],
    ['ui.initialTab', 'num'],
    ['ui.window.maximized', 'bool'],
    ['tray.enabled', 'bool'],
    ['tray.minimizeToTray', 'bool'],
    ['imageCache.enabled', 'bool'],
    ['imageCache.maxSizeMb', { buckets: [256, 512, 1024] }],
    ['logLevel', { enum: ['standard', 'verbose'] }],
    ['update.mode', { enum: ['ask', 'silent', 'off'] }],
    ['update.channel', { enum: ['stable', 'beta'] }],
    ['developer.enabled', 'bool']
  ],
  settings_integration: [
    ['discordRpc.enabled', 'bool'],
    ['discordRpc.showTitle', 'bool'],
    ['discordRpc.showThumbnail', 'bool'],
    ['discordRpc.showGithubButton', 'bool'],
    ['webhookNotify.enabled', 'bool'],
    ['webhookNotify.notifyOnDownloadComplete', 'bool'],
    ['webhookNotify.notifyOnDownloadFail', 'bool'],
    ['httpServer.enabled', 'bool'],
    ['httpServer.allowVideo', 'bool'],
    ['httpServer.allowMyList', 'bool'],
    ['remoteNndd.enabled', 'bool'],
    ['channelWatch.enabled', 'bool'],
    ['channelWatch.intervalMin', { buckets: [15, 30, 60] }]
  ]
};

function readPath(root: unknown, key: string): unknown {
  let node: unknown = root;
  for (const seg of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function bucket(value: number, thresholds: readonly number[]): string {
  for (const t of thresholds) {
    if (value <= t) return `<=${t}`;
  }
  return `>${thresholds[thresholds.length - 1]}`;
}

function convert(value: unknown, spec: Spec): string | number | boolean | undefined {
  if (spec === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (spec === 'num') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if ('enum' in spec) {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    return spec.enum.includes(value) ? String(value) : 'other';
  }
  return typeof value === 'number' && Number.isFinite(value) ? bucket(value, spec.buckets) : undefined;
}

/** 設定全体 (ConfigStore.store) から、送信する設定グループを組み立てる。値が取れない項目は省く */
export function buildSettingsSnapshot(config: unknown): { event: string; props: TelemetryProps }[] {
  const result: { event: string; props: TelemetryProps }[] = [];
  for (const [event, entries] of Object.entries(GROUPS)) {
    const props: TelemetryProps = {};
    for (const [key, spec] of entries) {
      const v = convert(readPath(config, key), spec);
      if (v !== undefined) props[key] = v;
    }
    // 連携の有無は件数でなく有無だけ (プロファイル名・Gist ID は送らない)
    if (event === 'settings_integration') {
      const profiles = readPath(config, 'githubSync.profiles');
      props['githubSync.hasProfile'] = Array.isArray(profiles) && profiles.length > 0;
    }
    if (Object.keys(props).length > 0) result.push({ event, props });
  }
  return result;
}
