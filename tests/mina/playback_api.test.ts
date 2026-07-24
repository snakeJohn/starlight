import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinaHTTPClient } from '../../src/mina/client';
import { needUsePlayMusicAPI } from '../../src/mina/constants';

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
});
