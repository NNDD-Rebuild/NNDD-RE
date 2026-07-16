import { GitHubApi } from '@shared/constants';

/** GitHub Device Flow: デバイスコード発行レスポンス */
export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | string };

/**
 * GitHub OAuth Device Flow のプロトコル実装 (ステートレス)。
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */
export class DeviceFlowAuth {
  static async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await fetch(GitHubApi.DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: GitHubApi.CLIENT_ID,
        scope: GitHubApi.SCOPE
      })
    });
    if (!res.ok) {
      throw new Error(`デバイスコード取得に失敗しました (HTTP ${res.status})`);
    }
    const json = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
    return {
      deviceCode: json.device_code,
      userCode: json.user_code,
      verificationUri: json.verification_uri,
      expiresIn: json.expires_in,
      interval: json.interval
    };
  }

  /** アクセストークンをポーリング取得 (1回分)。呼び出し側が interval 間隔で繰り返す。 */
  static async pollAccessToken(deviceCode: string): Promise<PollResult> {
    const res = await fetch(GitHubApi.ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: GitHubApi.CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });
    const json = (await res.json()) as {
      access_token?: string;
      error?: string;
    };
    if (json.access_token) {
      return { ok: true, accessToken: json.access_token };
    }
    return { ok: false, error: json.error ?? 'unknown_error' };
  }

  static async fetchUsername(accessToken: string): Promise<string | undefined> {
    const res = await fetch(GitHubApi.USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GitHubApi.API_VERSION
      }
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { login?: string };
    return json.login;
  }
}
