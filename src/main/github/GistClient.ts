import { GitHubApi } from '@shared/constants';
import type { GistRevision, GistSummary } from '@shared/types';
import { createLogger } from '../util/Logger';

const log = createLogger('GistClient');

export interface GistDetail {
  id: string;
  htmlUrl: string;
  description: string;
  updatedAt: string;
  files: Record<string, { content: string }>;
}

interface RawGist {
  id: string;
  html_url: string;
  description: string | null;
  updated_at: string;
  files: Record<string, { content?: string }>;
}

/**
 * GitHub Gist REST API クライアント。
 * https://docs.github.com/en/rest/gists/gists
 */
export class GistClient {
  constructor(private readonly token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GitHubApi.API_VERSION,
      'Content-Type': 'application/json'
    };
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: this.headers() });
    if (res.status === 401) {
      throw new Error('GitHub認証が無効です。再ログインしてください。');
    }
    if (res.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('GitHub APIのレート制限に達しました。しばらく待ってから再試行してください。');
    }
    if (!res.ok) {
      throw new Error(`GitHub API エラー (HTTP ${res.status})`);
    }
    return res;
  }

  private static toDetail(raw: RawGist): GistDetail {
    const files: Record<string, { content: string }> = {};
    for (const [name, file] of Object.entries(raw.files)) {
      files[name] = { content: file.content ?? '' };
    }
    return {
      id: raw.id,
      htmlUrl: raw.html_url,
      description: raw.description ?? '',
      updatedAt: raw.updated_at,
      files
    };
  }

  /** @param sha 省略時は最新版。指定時はそのリビジョン時点の内容を取得する */
  async get(gistId: string, sha?: string): Promise<GistDetail> {
    const url = sha
      ? `${GitHubApi.GIST_API_BASE}/${gistId}/${sha}`
      : `${GitHubApi.GIST_API_BASE}/${gistId}`;
    const res = await this.request(url);
    const raw = (await res.json()) as RawGist;
    return GistClient.toDetail(raw);
  }

  /** Gist のリビジョン (世代) 一覧を新しい順で取得 (最大100件) */
  async listRevisions(gistId: string): Promise<GistRevision[]> {
    interface RawCommit {
      version: string;
      committed_at: string;
      change_status?: { total?: number; additions?: number; deletions?: number };
    }
    const res = await this.request(`${GitHubApi.GIST_API_BASE}/${gistId}/commits?per_page=100`);
    const raws = (await res.json()) as RawCommit[];
    return raws
      .map((r) => ({
        sha: r.version,
        committedAt: r.committed_at,
        totalChanges: r.change_status?.total ?? 0
      }))
      .reverse();
  }

  async create(content: string, description: string): Promise<GistDetail> {
    const res = await this.request(GitHubApi.GIST_API_BASE, {
      method: 'POST',
      body: JSON.stringify({
        description,
        public: false,
        files: {
          [GitHubApi.BACKUP_FILE_NAME]: { content }
        }
      })
    });
    const raw = (await res.json()) as RawGist;
    log.debug('gist created:', raw.id);
    return GistClient.toDetail(raw);
  }

  async update(gistId: string, content: string): Promise<GistDetail> {
    const res = await this.request(`${GitHubApi.GIST_API_BASE}/${gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: {
          [GitHubApi.BACKUP_FILE_NAME]: { content }
        }
      })
    });
    const raw = (await res.json()) as RawGist;
    log.debug('gist updated:', raw.id);
    return GistClient.toDetail(raw);
  }

  /** 自分の Gist のうち、NNDD-RE が作成したもの (description固定文字列プレフィックス) のみ返す */
  async listCandidates(): Promise<GistSummary[]> {
    const res = await this.request(`${GitHubApi.GIST_API_BASE}?per_page=100`);
    const raws = (await res.json()) as RawGist[];
    return raws
      .filter((r) => (r.description ?? '').startsWith(GitHubApi.BACKUP_DESCRIPTION_PREFIX))
      .map((r) => ({
        id: r.id,
        description: r.description ?? '',
        updatedAt: r.updated_at,
        htmlUrl: r.html_url
      }));
  }
}
