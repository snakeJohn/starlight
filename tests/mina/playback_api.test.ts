import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinaHTTPClient } from '../../src/mina/client';
import { MINA_SID, needUsePlayMusicAPI } from '../../src/mina/constants';

function createClient(): MinaHTTPClient {
  return new MinaHTTPClient({
    user_id: 'user-1',
    device_id: 'client-device-1',
    services: {
      [MINA_SID]: {
        service_token: 'service-token',
        ssecurity: '',
        expires_at: Date.now() + 3600_000,
      },
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
}

describe('MIoT playback API model detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the Music API for Xiaoai Pro LX06 devices', () => {
    expect(needUsePlayMusicAPI('LX06')).toBe(true);
  });

  it('uses the Music API for LX05 devices', () => {
    expect(needUsePlayMusicAPI('LX05')).toBe(true);
  });

  it('falls back to player_play_url when player_play_music fails for Music API models', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const method = body.get('method');
      // Music API path fails at device layer (data.code != 0); URL path succeeds.
      if (method === 'player_play_music') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          text: async () => JSON.stringify({ code: 0, data: { code: 3012 } }),
        } as Response;
      }
      if (method === 'player_play_url') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          text: async () => JSON.stringify({ code: 0, data: { code: 0 } }),
        } as Response;
      }
      // pre-pause before play
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        text: async () => JSON.stringify({ code: 0, data: {} }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new MinaHTTPClient({
      user_id: 'user-1',
      device_id: 'client-device-1',
      services: {
        mina: {
          service_token: 'service-token',
          ssecurity: '',
          expires_at: Date.now() + 3600_000,
        },
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expect(client.playByUrl('speaker-1', 'http://example.com/song.mp3', 'LX05')).resolves.toBe(true);

    const methods = fetchMock.mock.calls.map(([, init]) => {
      const body = new URLSearchParams(String(init?.body));
      return body.get('method');
    });
    expect(methods).toContain('player_play_music');
    expect(methods).toContain('player_play_url');
  });

  it('treats device_list code===0 as valid token and rejects null/401', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      text: async () => JSON.stringify({ code: 0, data: [] }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MinaHTTPClient({
      user_id: 'user-1',
      device_id: 'client-device-1',
      services: {
        mina: {
          service_token: 'service-token',
          ssecurity: '',
          expires_at: Date.now() + 3600_000,
        },
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expect(client.validateToken()).resolves.toBe(true);

    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      text: async () => '',
    } as Response));
    // 401 without refresh callback → null response → invalid token
    await expect(client.validateToken()).resolves.toBe(false);
  });

  it('pauses before stopping playback to match the working MIoT plugin behavior', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      text: async () => JSON.stringify({ code: 0, data: {} }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MinaHTTPClient({
      user_id: 'user-1',
      device_id: 'client-device-1',
      services: {
        mina: {
          service_token: 'service-token',
          ssecurity: '',
          expires_at: Date.now() + 3600_000,
        },
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expect(client.playerStop('speaker-1')).resolves.toBe(true);

    const actions = fetchMock.mock.calls.map(([, init]) => {
      const body = new URLSearchParams(String(init?.body));
      const message = JSON.parse(body.get('message') || '{}') as { action?: string };
      return {
        method: body.get('method'),
        path: body.get('path'),
        action: message.action,
      };
    });
    expect(actions).toEqual([
      { method: 'player_play_operation', path: 'mediaplayer', action: 'pause' },
      { method: 'player_play_operation', path: 'mediaplayer', action: 'stop' },
    ]);
  });

  it('sends a millisecond timestamp to the Xiaomi music search API', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        // 手写 JSON：audioID 是 int64，经 JSON.stringify(number) 会先丢精度
        text: async () => '{"code":0,"data":{"songList":[{"audioID":1732418460076477549,"name":"歌名","artist":{"name":"歌手"}}]}}',
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    await expect(createClient().searchAudioId('歌名-歌手', 'fallback-id')).resolves.toBe('1732418460076477549');

    const timestamp = Number(new URLSearchParams(bodies[0]).get('timestamp'));
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('falls back to the default audio id when songList is not an array', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      text: async () => JSON.stringify({ code: 0, data: { songList: { unexpected: true } } }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClient().searchAudioId('歌名-歌手', 'fallback-id')).resolves.toBe('fallback-id');
  });

  it('returns an empty device list when the API sends a non-array data field', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      text: async () => JSON.stringify({ code: 0, message: 'ok', data: { total: 0 } }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClient().getDeviceList()).resolves.toEqual([]);
  });
});
