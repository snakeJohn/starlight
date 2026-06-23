import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSongloftLibraryHandlers } from '../../src/handlers/songloft_library';

interface MainGlobals {
  onInit(): Promise<void>;
  onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse>;
}

function request(method: string, path: string): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: null,
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function createHarness() {
  const router = createRouter();
  registerSongloftLibraryHandlers(router);
  return { router };
}

describe('registerSongloftLibraryHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Songloft songs from songloft.songs.list and normalizes items/count responses', async () => {
    songloft.songs.list = vi.fn(async () => ({
      items: [{ id: 'song-1', title: 'Song A' }],
      count: 8,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: {
        list: [{ id: 'song-1', title: 'Song A' }],
        total: 8,
      },
      error: null,
    });
  });

  it('returns Songloft playlists from songloft.playlists.list and normalizes playlists/total responses', async () => {
    songloft.playlists.list = vi.fn(async () => ({
      playlists: [{ id: 'playlist-1', name: 'Daily Mix' }],
      total: 3,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/playlists'));

    expect(response.statusCode).toBe(200);
    expect(songloft.playlists.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'playlist-1', name: 'Daily Mix' }],
      total: 3,
    });
  });

  it('returns playlist songs from songloft.playlists.getSongs and normalizes songs/count responses', async () => {
    songloft.playlists.getSongs = vi.fn(async () => ({
      songs: [{ id: 'song-2', title: 'Playlist Song' }],
      count: 11,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/playlists/playlist-1/songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.playlists.getSongs).toHaveBeenCalledWith('playlist-1');
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'song-2', title: 'Playlist Song' }],
      total: 11,
    });
  });

  it('returns only local songs using common type and local markers', async () => {
    songloft.songs.list = vi.fn(async () => [
      { id: 'local-1', title: 'Local A', type: 'local' },
      { id: 'local-2', title: 'Local B', type: 'LOCAL' },
      { id: 'local-3', title: 'Local C', local: true },
      { id: 'remote-1', title: 'Remote A', type: 'remote' },
      { id: 'remote-2', title: 'Remote B', local: false },
    ]);
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/local-songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [
        { id: 'local-1', title: 'Local A', type: 'local' },
        { id: 'local-2', title: 'Local B', type: 'LOCAL' },
        { id: 'local-3', title: 'Local C', local: true },
      ],
      total: 3,
    });
  });

  it('registers Songloft library routes during plugin init', async () => {
    vi.resetModules();
    songloft.songs.list = vi.fn(async () => [{ id: 'song-main', title: 'From Main' }]);
    songloft.playlists.list = vi.fn(async () => []);
    songloft.playlists.getSongs = vi.fn(async () => []);

    await import('../../src/main');
    await (globalThis as typeof globalThis & MainGlobals).onInit();

    const response = await (globalThis as typeof globalThis & MainGlobals).onHTTPRequest(
      request('GET', '/api/songloft/songs'),
    );

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'song-main', title: 'From Main' }],
      total: 1,
    });
  });
});
