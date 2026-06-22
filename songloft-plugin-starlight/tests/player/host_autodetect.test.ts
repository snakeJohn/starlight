import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerPlaylistHandlers } from '../../src/handlers/playlist';
import type { ConfigManager } from '../../src/config/manager';
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
    const configManager = {
      getConfig: vi.fn(async () => ({ server_host: '' })),
    } as unknown as ConfigManager;

    registerPlaylistHandlers(router, managerMap, {} as MinaService, configManager);

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
});
