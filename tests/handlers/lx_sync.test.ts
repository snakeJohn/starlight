import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerLxSyncHandlers } from '../../src/handlers/lx_sync';
import type { LxSyncService } from '../../src/lx_sync/service';

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

const publicConfig = {
  baseUrl: 'http://lx.test',
  username: 'alice',
  connected: true,
  importDefaultList: true,
  conflict: 'replace' as const,
};

function createHarness() {
  const router = createRouter();
  const service = {
    getConfig: vi.fn(async () => publicConfig),
    updateConfig: vi.fn(async (patch) => ({ ...publicConfig, ...patch, connected: false })),
    connect: vi.fn(async () => publicConfig),
    disconnect: vi.fn(async () => ({ ...publicConfig, connected: false })),
    preview: vi.fn(async () => ({
      playlists: [{ id: 'lx:love', name: '我喜欢', songCount: 1, kind: 'love' }],
      totalSongs: 1,
    })),
    pull: vi.fn(async () => ({
      playlistsCreated: 1,
      playlistsUpdated: 0,
      songsImported: 1,
      playlists: [],
      lastSyncAt: '2026-07-18T00:00:00.000Z',
    })),
    importToSongloft: vi.fn(async (ids: string[]) => ({
      results: ids.map((id) => ({ id, total: 0, skipped: 0, errors: [] })),
    })),
  } as unknown as LxSyncService;

  registerLxSyncHandlers(router, service);
  return { router, service };
}

describe('registerLxSyncHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets and puts config without password', async () => {
    const { router, service } = createHarness();

    const getRes = await router.handle(request('GET', '/api/lx-sync/config'));
    expect(getRes.statusCode).toBe(200);
    expect(parseResponseBody(getRes).data).toEqual(publicConfig);

    const putRes = await router.handle(
      request('PUT', '/api/lx-sync/config', {
        baseUrl: 'http://lx2.test',
        importDefaultList: false,
        conflict: 'merge',
      }),
    );
    expect(putRes.statusCode).toBe(200);
    expect(service.updateConfig).toHaveBeenCalledWith({
      baseUrl: 'http://lx2.test',
      importDefaultList: false,
      conflict: 'merge',
    });

    const badPut = await router.handle(
      request('PUT', '/api/lx-sync/config', { password: 'nope' }),
    );
    expect(badPut.statusCode).toBe(400);
    expect(parseResponseBody(badPut).error.message).toMatch(/password/i);
  });

  it('connects, disconnects, previews, pulls, imports', async () => {
    const { router, service } = createHarness();

    const connectRes = await router.handle(
      request('POST', '/api/lx-sync/connect', {
        baseUrl: 'http://lx.test',
        username: 'alice',
        password: 'secret',
      }),
    );
    expect(connectRes.statusCode).toBe(200);
    expect(service.connect).toHaveBeenCalledWith({
      baseUrl: 'http://lx.test',
      username: 'alice',
      password: 'secret',
    });

    expect((await router.handle(request('POST', '/api/lx-sync/disconnect'))).statusCode).toBe(200);
    expect(service.disconnect).toHaveBeenCalled();

    const previewRes = await router.handle(request('GET', '/api/lx-sync/preview'));
    expect(parseResponseBody(previewRes).data.totalSongs).toBe(1);

    const pullRes = await router.handle(request('POST', '/api/lx-sync/pull'));
    expect(parseResponseBody(pullRes).data.playlistsCreated).toBe(1);

    const importRes = await router.handle(
      request('POST', '/api/lx-sync/import-to-songloft', { playlist_ids: ['a', 'b'] }),
    );
    expect(parseResponseBody(importRes).data.results).toHaveLength(2);
    expect(service.importToSongloft).toHaveBeenCalledWith(['a', 'b']);
  });
});
