import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerPlaylistHandlers } from '../../src/handlers/playlist';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

type SongloftPlaylistsStub = {
  getSongs: (playlistId: number, options?: { limit?: number; offset?: number }) => Promise<unknown>;
};

function createHarness() {
  const router = createRouter();
  const play = vi.fn(async () => true);
  const playlistManagerMap = {
    get: vi.fn(() => undefined),
    getOrCreate: vi.fn(async () => ({
      play,
      getCurrentSong: vi.fn(() => null),
    })),
  } as unknown as PlaylistManagerMap;
  const minaService = {} as MinaService;

  registerPlaylistHandlers(router, playlistManagerMap, minaService);
  return { router, playlistManagerMap, play };
}

describe('registerPlaylistHandlers input validation', () => {
  it('rejects fractional, negative and overflowing playlist ids before calling the host API', async () => {
    const getSongs = vi.fn(async () => []);
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = getSongs;
    const { router } = createHarness();

    for (const id of ['1.5', '-3', '1e400', 'abc']) {
      const response = await router.handle(request('GET', `/playlists/${id}/songs`));
      expect(parseResponseBody(response)).toEqual({ success: false, error: 'invalid playlist id' });
    }

    expect(getSongs).not.toHaveBeenCalled();
  });

  it('still loads songs for a valid positive playlist id', async () => {
    const getSongs = vi.fn(async () => [{ id: 7, title: 'Song' }]);
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = getSongs;
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/playlists/12/songs'));

    expect(getSongs).toHaveBeenCalledWith(12, { limit: 100000 });
    expect(parseResponseBody(response)).toEqual({ success: true, data: [{ id: 7, title: 'Song' }] });
  });

  it('rejects a fractional playlist_id on /player/play but keeps negative dynamic ids', async () => {
    const { router, play } = createHarness();

    const fractional = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 1.5,
    }));
    expect(parseResponseBody(fractional)).toEqual({ success: false, error: 'invalid playlist_id' });
    expect(play).not.toHaveBeenCalled();

    const dynamic = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: -2,
    }));
    expect(parseResponseBody(dynamic).success).toBe(true);
    expect(play).toHaveBeenCalledWith(-2, 0, 'order');
  });
});
