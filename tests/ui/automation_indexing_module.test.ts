import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationIndexingModule {
  refreshIndexing(): Promise<void>;
}

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

function installDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  const indexingState = { textContent: '' };
  const indexPlaylists = { textContent: '' };
  const indexSongs = { textContent: '' };
  const indexUpdated = { textContent: '' };
  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => {
      if (selector === '[data-role="indexing-state"]') return indexingState;
      if (selector === '[data-role="index-playlists"]') return indexPlaylists;
      if (selector === '[data-role="index-songs"]') return indexSongs;
      if (selector === '[data-role="index-updated"]') return indexUpdated;
      return null;
    }),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => node),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
  return { indexingState };
}

describe('automation indexing module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('refreshes indexing through the extracted module and updates the summary state', async () => {
    const { indexingState } = installDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/indexing/refresh')) {
        return okResponse({});
      }
      if (url.endsWith('/miot/indexing/status')) {
        return okResponse({
          is_refreshing: false,
          ready: true,
          playlist_count: 12,
          song_count: 48,
          last_refresh_time: '2026-06-25T09:12:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/automation_modules/indexing.js';
    const { refreshIndexing } = await import(modulePath) as AutomationIndexingModule;

    await refreshIndexing();

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'api/miot/indexing/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'api/miot/indexing/status', expect.objectContaining({
      headers: expect.any(Object),
    }));
    expect(indexingState.textContent).toBe('已就绪');
  });
});
