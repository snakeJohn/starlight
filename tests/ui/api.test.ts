import { afterEach, describe, expect, it, vi } from 'vitest';

interface StaticApiModule {
  api: {
    get(path: string): Promise<unknown>;
    getEnvelope(path: string): Promise<Record<string, unknown>>;
  };
}

const successResponse = {
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { platforms: [] } }),
};

describe('static api helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the Songloft auth token with plugin API requests', async () => {
    const fetchMock = vi.fn(async () => successResponse as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      SongloftPlugin: {
        getAuthToken: () => 'ui-token',
      },
    });

    const modulePath = '../../static/js/api.js';
    const { api } = await import(modulePath) as StaticApiModule;

    await api.get('/music/platforms');

    expect(fetchMock).toHaveBeenCalledWith('api/music/platforms', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ui-token',
      },
    });
  });

  it('preserves response metadata such as expired for callers that need the envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [], expired: true }),
    }) as Response));
    vi.stubGlobal('window', { SongloftPlugin: { getAuthToken: () => '' } });

    const { api } = await import('../../static/js/api.js') as StaticApiModule;
    await expect(api.getEnvelope('/songloft/playlists/-100001/songs')).resolves.toEqual({
      data: [],
      expired: true,
    });
  });
});
