import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest } from '@songloft/plugin-sdk';
import { registerLxSyncHandlers } from '../../src/handlers/lx_sync';
import { LxSyncService } from '../../src/lx_sync/service';
import { CustomPlaylistStore } from '../../src/custom_playlists/store';

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

describe('lx-sync handlers (local JSON)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supports config, preview, import, export without server login', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    const router = createRouter();
    registerLxSyncHandlers(router, service);

    const getRes = await router.handle(request('GET', '/api/lx-sync/config'));
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(String(getRes.body));
    expect(getBody.data.conflict).toBe('replace');
    expect(getBody.data).not.toHaveProperty('baseUrl');

    const rejectCreds = await router.handle(
      request('PUT', '/api/lx-sync/config', { baseUrl: 'http://x', username: 'u' }),
    );
    expect(rejectCreds.statusCode).toBe(400);

    const putRes = await router.handle(
      request('PUT', '/api/lx-sync/config', { conflict: 'merge', importDefaultList: false }),
    );
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(String(putRes.body)).data.conflict).toBe('merge');

    const listData = {
      defaultList: [],
      loveList: [{ id: '1', name: 'A', singer: 'B', source: 'kw', interval: '01:00', meta: {} }],
      userList: [],
    };

    const previewRes = await router.handle(request('POST', '/api/lx-sync/preview', { listData }));
    expect(previewRes.statusCode).toBe(200);
    expect(JSON.parse(String(previewRes.body)).data.totalSongs).toBe(1);

    const importRes = await router.handle(request('POST', '/api/lx-sync/import', { listData }));
    expect(importRes.statusCode).toBe(200);
    expect(JSON.parse(String(importRes.body)).data.playlistsCreated).toBeGreaterThan(0);
    expect((await store.loadAll()).length).toBeGreaterThan(0);

    const exportRes = await router.handle(request('POST', '/api/lx-sync/export', {}));
    expect(exportRes.statusCode).toBe(200);
    const exported = JSON.parse(String(exportRes.body)).data.listData;
    expect(exported.loveList.length).toBeGreaterThan(0);
  });

  it('import-to-songloft requires playlist ids', async () => {
    const service = new LxSyncService({
      customPlaylists: {
        syncToSongloftPlaylist: vi.fn(async () => ({
          playlist: { id: 'x', name: 'x', cover_url: '', imported_at: '', updated_at: '', songs: [] },
          total: 0,
          skipped: 0,
          errors: [],
        })),
      },
    });
    const router = createRouter();
    registerLxSyncHandlers(router, service);
    const bad = await router.handle(request('POST', '/api/lx-sync/import-to-songloft', {}));
    expect(bad.statusCode).toBe(400);
  });
});
