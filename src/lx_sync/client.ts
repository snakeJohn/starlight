import { StarlightError } from '../system/errors';
import { isLxListData, normalizeBaseUrl } from './mapper';
import type { LxListData } from './types';

export interface LxSyncClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

interface LoginResponse {
  success?: boolean;
  token?: string;
  message?: string;
  error?: string | { message?: string };
}

/**
 * HTTP client for LX Sync Server (lxserver / lx-music-sync-server compatible).
 * Uses POST /api/user/login and GET/POST /api/user/list with x-user-token.
 */
export class LxSyncClient {
  private readonly baseUrl: string;
  private token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LxSyncClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token || '';
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getToken(): string {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async login(username: string, password: string): Promise<string> {
    if (!this.baseUrl) {
      throw new StarlightError('BAD_REQUEST', 'baseUrl is required');
    }
    const user = username.trim();
    if (!user) {
      throw new StarlightError('BAD_REQUEST', 'username is required');
    }
    if (!password) {
      throw new StarlightError('BAD_REQUEST', 'password is required');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      });
    } catch (error) {
      throw new StarlightError(
        'INTERNAL_ERROR',
        `无法连接洛雪同步服务: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    let payload: LoginResponse = {};
    try {
      payload = (await response.json()) as LoginResponse;
    } catch {
      payload = {};
    }

    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    if (!response.ok || !token) {
      const message =
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        (payload.error && typeof payload.error === 'object' && payload.error.message) ||
        `登录失败 (${response.status})`;
      throw new StarlightError('AUTH_PASSWORD_FAILED', String(message), false);
    }

    this.token = token;
    return token;
  }

  async getList(): Promise<LxListData> {
    this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/user/list`, {
        method: 'GET',
        headers: this.authHeaders(),
      });
    } catch (error) {
      throw new StarlightError(
        'INTERNAL_ERROR',
        `拉取歌单失败: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const payload = await this.readJson(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new StarlightError(
          'AUTH_TOKEN_EXPIRED',
          this.errorMessage(payload, '洛雪同步登录已失效，请重新连接'),
          false,
        );
      }
      throw new StarlightError('INTERNAL_ERROR', this.errorMessage(payload, `拉取歌单失败 (${response.status})`), true);
    }

    const data = this.unwrapListData(payload);
    if (!data) {
      throw new StarlightError('INTERNAL_ERROR', '服务器返回的歌单数据格式无效', false);
    }
    return data;
  }

  /**
   * Full overwrite of server list data. v1 optional; warns callers of destructive nature.
   */
  async setList(data: LxListData): Promise<void> {
    this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/user/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify(data),
      });
    } catch (error) {
      throw new StarlightError(
        'INTERNAL_ERROR',
        `推送歌单失败: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    if (!response.ok) {
      const payload = await this.readJson(response);
      throw new StarlightError('INTERNAL_ERROR', this.errorMessage(payload, `推送歌单失败 (${response.status})`), true);
    }
  }

  private requireToken(): void {
    if (!this.token) {
      throw new StarlightError('AUTH_TOKEN_EXPIRED', '未连接洛雪同步服务，请先登录', false);
    }
    if (!this.baseUrl) {
      throw new StarlightError('BAD_REQUEST', 'baseUrl is required');
    }
  }

  private authHeaders(): Record<string, string> {
    return { 'x-user-token': this.token };
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private unwrapListData(payload: unknown): LxListData | null {
    if (isLxListData(payload)) {
      return {
        defaultList: Array.isArray(payload.defaultList) ? payload.defaultList : [],
        loveList: Array.isArray(payload.loveList) ? payload.loveList : [],
        userList: Array.isArray(payload.userList) ? payload.userList : [],
      };
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (isLxListData(record.data)) {
        return this.unwrapListData(record.data);
      }
    }
    return null;
  }

  private errorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') return fallback;
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message) return record.message;
    if (typeof record.error === 'string' && record.error) return record.error;
    if (record.error && typeof record.error === 'object') {
      const err = record.error as Record<string, unknown>;
      if (typeof err.message === 'string' && err.message) return err.message;
    }
    return fallback;
  }
}
