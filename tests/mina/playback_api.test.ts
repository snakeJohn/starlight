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
