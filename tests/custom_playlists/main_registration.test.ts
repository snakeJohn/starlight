import type { HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

interface MainGlobals {
  onInit(): Promise<void>;
  onHTTPRequest(req: { method: string; path: string; query: string; headers: Record<string, string>; body?: string | null }): Promise<HTTPResponse>;
}

function mainGlobals(): MainGlobals {
  return globalThis as typeof globalThis & MainGlobals;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

async function request(path: string, method = 'GET', body?: unknown): Promise<HTTPResponse> {
  return mainGlobals().onHTTPRequest({
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function waitForIndexStatus(expectedPlaylistCount: number): Promise<any> {
  for (let index = 0; index < 20; index += 1) {
    const status = parseResponseBody(await request('/api/miot/indexing/status')).data;
    if (status.playlist_count === expectedPlaylistCount) {
      return status;
    }
    await Promise.resolve();
  }
  return parseResponseBody(await request('/api/miot/indexing/status')).data;
}

describe('custom playlist route registration', () => {
  it('registers custom playlist routes during plugin init', async () => {
    vi.resetModules();
    await import('../../src/main');
    await mainGlobals().onInit();

    const response = await mainGlobals().onHTTPRequest({
      method: 'GET',
      path: '/api/custom-playlists',
      query: '',
      headers: {},
      body: null,
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: [],
      error: null,
    });
  });

  it('wires custom playlists into the indexing manager during plugin init', async () => {
    vi.resetModules();
    songloft.playlists.list = vi.fn(async () => []);
    songloft.playlists.getSongs = vi.fn(async () => []);
    songloft.songs.list = vi.fn(async () => []);
    await songloft.storage.set('starlight:custom_playlists:index', JSON.stringify([
      {
        id: 'custom_1',
        name: '古风',
        cover_url: '',
        imported_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '为龙',
            duration: 260,
            cover_url: '',
            source_name: '酷狗',
            stable_key: 'kg:hash-1',
            source_data: {
              platform: 'kg',
              quality: '320k',
              songInfo: { source: 'kg', name: '为龙', singer: '河图', album: '为龙', duration: 260, hash: 'hash-1' },
            },
          },
        ],
      },
    ]));

    await import('../../src/main');
    await mainGlobals().onInit();
    await request('/api/miot/indexing/refresh', 'POST');

    await expect(waitForIndexStatus(1)).resolves.toMatchObject({
      playlist_count: 1,
      song_count: 1,
    });
  });
});
