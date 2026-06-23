import { afterEach, describe, expect, it, vi } from 'vitest';

interface StaticApiModule {
  api: {
    get(path: string): Promise<unknown>;
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
});
