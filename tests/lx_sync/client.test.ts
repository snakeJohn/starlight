import { afterEach, describe, expect, it, vi } from 'vitest';
import { LxSyncClient } from '../../src/lx_sync/client';
import { StarlightError } from '../../src/system/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('LxSyncClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs in and stores token without exposing password in errors', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://192.168.1.10:9527/api/user/login');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toEqual({ username: 'alice', password: 'secret' });
      return jsonResponse({ success: true, token: 'tok-abc' });
    });

    const client = new LxSyncClient({
      baseUrl: 'http://192.168.1.10:9527/',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.login('alice', 'secret')).resolves.toBe('tok-abc');
    expect(client.getToken()).toBe('tok-abc');
    expect(client.getBaseUrl()).toBe('http://192.168.1.10:9527');
  });

  it('fetches list with x-user-token header', async () => {
    const listData = {
      defaultList: [],
      loveList: [{ id: '1', name: 'A', singer: 'B', source: 'kw', interval: '01:00', meta: {} }],
      userList: [],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://lx.test/api/user/list');
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>)['x-user-token']).toBe('tok-1');
      return jsonResponse(listData);
    });

    const client = new LxSyncClient({
      baseUrl: 'http://lx.test',
      token: 'tok-1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getList()).resolves.toEqual(listData);
  });

  it('unwraps nested data envelopes', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { defaultList: [], loveList: [], userList: [] },
      }),
    );
    const client = new LxSyncClient({
      baseUrl: 'http://lx.test',
      token: 't',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(client.getList()).resolves.toEqual({
      defaultList: [],
      loveList: [],
      userList: [],
    });
  });

  it('throws AUTH_PASSWORD_FAILED on bad credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: false, message: 'invalid' }, 401));
    const client = new LxSyncClient({
      baseUrl: 'http://lx.test',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(client.login('u', 'p')).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_FAILED',
    } satisfies Partial<StarlightError>);
  });

  it('requires token before getList', async () => {
    const client = new LxSyncClient({ baseUrl: 'http://lx.test', fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(client.getList()).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('posts setList with auth header', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://lx.test/api/user/list');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['x-user-token']).toBe('tok');
      return jsonResponse({ success: true });
    });
    const client = new LxSyncClient({
      baseUrl: 'http://lx.test',
      token: 'tok',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(
      client.setList({ defaultList: [], loveList: [], userList: [] }),
    ).resolves.toBeUndefined();
  });
});
