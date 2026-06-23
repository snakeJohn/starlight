import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerPlaylistHandlers } from '../../src/handlers/playlist';
import type { MinaService } from '../../src/service/service';
import type { PlaylistManagerMap } from '../../src/player/manager';

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

describe('playlist host auto-detection', () => {
  it('starts playlist playback without requiring a manually configured server_host', async () => {
    const router = createRouter();
    const manager = {
      play: vi.fn(async () => true),
      getCurrentSong: vi.fn(() => ({ title: 'Song' })),
    };
    const managerMap = {
      getOrCreate: vi.fn(async () => manager),
    } as unknown as PlaylistManagerMap;
    registerPlaylistHandlers(router, managerMap, {} as MinaService);

    const response = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 7,
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: {
        message: 'playlist started',
      },
    });
    expect(manager.play).toHaveBeenCalledWith(7, 0, 'order');
  });

  it('rejects invalid play mode and negative start index before calling the playlist manager', async () => {
    const router = createRouter();
    const manager = {
      play: vi.fn(async () => true),
      getCurrentSong: vi.fn(() => ({ title: 'Song' })),
      setPlayMode: vi.fn(async () => {}),
    };
    const managerMap = {
      getOrCreate: vi.fn(async () => manager),
      get: vi.fn(() => manager),
    } as unknown as PlaylistManagerMap;
    registerPlaylistHandlers(router, managerMap, {} as MinaService);

    const invalidMode = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 7,
      play_mode: 'shuffle_all',
    }));
    const invalidStartIndex = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 7,
      start_index: -1,
    }));
    const invalidModeChange = await router.handle(request('POST', '/player/mode', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      play_mode: 'shuffle_all',
    }));

    expect(parseResponseBody(invalidMode).success).toBe(false);
    expect(parseResponseBody(invalidStartIndex).success).toBe(false);
    expect(parseResponseBody(invalidModeChange).success).toBe(false);
    expect(manager.play).not.toHaveBeenCalled();
    expect(manager.setPlayMode).not.toHaveBeenCalled();
  });
});
