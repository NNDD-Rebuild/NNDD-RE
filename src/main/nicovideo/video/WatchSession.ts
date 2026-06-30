import type { WatchPageInfo, DomandStreamCandidate } from '@shared/types';
import { NicoContext } from '../NicoContext';
import { createLogger } from '../../util/Logger';
import * as path from 'path';

const log = createLogger('WatchSession');

/**
 * セッション確立結果。
 */
export interface SessionResult {
  /** マスター m3u8 URL */
  contentUrl: string;
  /** セッションID (DMC のみ。DMSは使わない) */
  sessionId: string | null;
  /** DMS なら true、DMC なら false */
  isDMS: boolean;
  /** heartbeat 用 JSON 文字列 (DMC のみ) */
  dmcResponseJson: string | null;
  /** 失効までの予想時刻 (ms) */
  expireAt: number;
}

/**
 * 視聴セッションを確立し、HLS マスタープレイリストURLを得る。
 *
 * 元: Niconicome-develop の Download/Video/V3/Session/WatchSession.cs
 *  (アドオン経由部分はここで直接実装)
 *
 * 内部的に 2 系統:
 *  1. DMS (media.domand): 新方式。POST /v1/watch/{id}/access-rights/hls で master.m3u8 URL を得る
 *  2. DMC (media.delivery): 旧方式。POST /api/sessions、定期heartbeat (40秒間隔)
 */
export class WatchSession {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private session: SessionResult | null = null;
  private videoId: string;

  constructor(private readonly watch: WatchPageInfo) {
    this.videoId = watch.videoId;
  }

  /**
   * セッションを確立する。返り値の contentUrl で master.m3u8 を取得できる。
   */
  async ensure(audioOnly?: boolean): Promise<SessionResult> {
    if (this.session) return this.session;

    if (!this.watch.isDownloadable) {
      throw new Error(
        this.watch.isEncrypted
          ? '動画が暗号化されているためダウンロードできません'
          : '動画がダウンロード不可能な状態です (会員限定/削除済み等)'
      );
    }

    // audioOnly は DMS 必須（DMC は音声のみ非対応）
    if (audioOnly) {
      if (!this.watch.domandAccessRightKey || this.watch.domandAudios.length === 0) {
        throw new Error('音声のみ再生には DMS が必要ですが、この動画では利用できません');
      }
      this.session = await this.ensureDMS(true);
      return this.session;
    }

    // DMS が利用可能なら優先、失敗時は DMC にフォールバック
    if (this.watch.domandAccessRightKey && this.watch.domandVideos.length > 0) {
      try {
        this.session = await this.ensureDMS();
      } catch (dmsErr) {
        if (this.watch.dmcSessionRequestJson) {
          log.warn('DMS failed, falling back to DMC:', dmsErr);
          this.session = await this.ensureDMC();
        } else {
          throw new Error(`DMS セッション取得失敗 (ログインが必要な可能性があります): ${String(dmsErr)}`);
        }
      }
    } else if (this.watch.dmcSessionRequestJson) {
      this.session = await this.ensureDMC();
    } else {
      throw new Error('利用可能なストリームが見つかりません (DMSもDMCも未提供)');
    }

    return this.session;
  }

  /**
   * DMS API でセッションを確立する。
   *
   * POST https://nvapi.nicovideo.jp/v1/watch/{videoId}/access-rights/hls?actionTrackId=...
   * Headers: X-Access-Right-Key: {accessRightKey}
   * Body:    { outputs: [["video-id", "audio-id"]] }
   *
   * Response:
   *   { data: { contentUrl: "https://...master.m3u8", createTime, expireTime } }
   */
  private async ensureDMS(audioOnly?: boolean): Promise<SessionResult> {
    const ctx = NicoContext.get();
    const accessRightKey = this.watch.domandAccessRightKey!;

    const audio = this.pickBestStream(this.watch.domandAudios);
    if (!audio) {
      throw new Error('DMS の audios に利用可能な候補がありません');
    }

    const video = audioOnly ? null : this.pickBestStream(this.watch.domandVideos);
    if (!audioOnly && !video) {
      throw new Error('DMS の videos に利用可能な候補がありません');
    }

    const url = `https://nvapi.nicovideo.jp/v1/watch/${encodeURIComponent(
      this.videoId
    )}/access-rights/hls?actionTrackId=${this.generateActionTrackId()}`;

    log.info('DMS session ensure:', url, audioOnly ? 'audioOnly' : `video=${video!.id}`, 'audio=', audio.id);

    interface AccessRightsResponse {
      data?: {
        contentUrl?: string;
        createTime?: string;
        expireTime?: string;
      };
      meta?: { status: number };
    }

    // debugDumpPath の設定 (設定画面から有効化)
    let debugDumpPath: string | undefined;
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    const developerEnabled = configStore.get('developer.enabled') ?? false;
    const developerTargets = configStore.get('developer.apiDumpTargets') ?? [];

    if (developerEnabled && developerTargets.includes('session')) {
      debugDumpPath = configStore.get('developer.apiDumpPath') || path.join(process.cwd(), 'apitest');
      log.info(`Session API dump enabled: ${debugDumpPath}`);
    }

    const outputs = audioOnly ? [[audio.id]] : [[video!.id, audio.id]];
    const res = await ctx.http.postJson<AccessRightsResponse>(
      url,
      { outputs },
      {
        headers: {
          'X-Access-Right-Key': accessRightKey,
          'X-Request-With': 'https://www.nicovideo.jp'
        },
        debugDumpPath,
        debugLabel: 'session-dms'
      }
    );

    const contentUrl = res?.data?.contentUrl;
    if (!contentUrl) {
      throw new Error('DMS access-rights APIからcontentUrlが取得できません');
    }

    // expireTime はISO文字列で来る
    let expireAt = Date.now() + 1000 * 60 * 60; // フォールバック 1時間
    if (res.data?.expireTime) {
      const t = Date.parse(res.data.expireTime);
      if (!isNaN(t)) expireAt = t;
    }

    return {
      contentUrl,
      sessionId: null,
      isDMS: true,
      dmcResponseJson: null,
      expireAt
    };
  }

  /**
   * DMC 旧方式でセッションを確立する。
   *
   * POST https://api.dmc.nico/api/sessions?_format=json
   * Body: watch JSONの media.delivery.movie.session そのまま (ラップして"session"プロパティに入れる)
   * Response: { data: { session: { id, content_uri, ... } } }
   *
   * その後 PUT /api/sessions/{id}?_format=json&_method=PUT を 40秒間隔で送る (heartbeat)
   */
  private async ensureDMC(): Promise<SessionResult> {
    const ctx = NicoContext.get();
    const reqTemplate = JSON.parse(this.watch.dmcSessionRequestJson!);
    const body = { session: reqTemplate };

    interface DmcSessionResponse {
      data?: {
        session?: {
          id: string;
          content_uri: string;
          [k: string]: unknown;
        };
      };
    }

    // debugDumpPath の設定 (設定画面から有効化)
    let debugDumpPath: string | undefined;
    const configStore = (await import('../../config/ConfigStore')).getConfigStore();
    const developerEnabled = configStore.get('developer.enabled') ?? false;
    const developerTargets = configStore.get('developer.apiDumpTargets') ?? [];

    if (developerEnabled && developerTargets.includes('session')) {
      debugDumpPath = configStore.get('developer.apiDumpPath') || path.join(process.cwd(), 'apitest');
      log.info(`Session API dump enabled: ${debugDumpPath}`);
    }

    const url = 'https://api.dmc.nico/api/sessions?_format=json';
    const res = await ctx.http.postJson<DmcSessionResponse>(url, body, {
      debugDumpPath,
      debugLabel: 'session-dmc'
    });
    const session = res?.data?.session;
    if (!session?.id || !session.content_uri) {
      throw new Error('DMC session APIから ID/content_uri が取得できません');
    }

    // heartbeat 開始 (40秒間隔)
    this.startHeartbeat(session.id, session);

    return {
      contentUrl: session.content_uri,
      sessionId: session.id,
      isDMS: false,
      dmcResponseJson: JSON.stringify({ session }),
      expireAt: Date.now() + 1000 * 60 * 60
    };
  }

  private startHeartbeat(
    sessionId: string,
    sessionData: Record<string, unknown>
  ): void {
    this.stopHeartbeat();
    const interval = 40_000;
    const ctx = NicoContext.get();
    const url = `https://api.dmc.nico/api/sessions/${encodeURIComponent(
      sessionId
    )}?_format=json&_method=PUT`;
    this.heartbeatTimer = setInterval(() => {
      ctx.http
        .fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessionData })
        })
        .then((r) => {
          if (!r.ok) log.warn('heartbeat failed:', r.status);
          else log.debug('heartbeat ok');
        })
        .catch((e) => log.warn('heartbeat error:', e));
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  dispose(): void {
    this.stopHeartbeat();
    this.session = null;
  }

  private pickBestStream(
    candidates: DomandStreamCandidate[]
  ): DomandStreamCandidate | null {
    const available = candidates.filter((c) => c.isAvailable);
    if (available.length === 0) return null;
    available.sort((a, b) => b.qualityLevel - a.qualityLevel);
    return available[0];
  }

  private generateActionTrackId(): string {
    // 12文字のランダムID + アンダースコア + ms単位タイムスタンプ
    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let r = '';
    for (let i = 0; i < 10; i++) {
      r += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${r}_${Date.now()}`;
  }
}
