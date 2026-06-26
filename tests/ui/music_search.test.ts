import { afterEach, describe, expect, it, vi } from 'vitest';

interface SearchModule {
  loadSearchPage(page?: number): Promise<void>;
}

interface StateModule {
  state: {
    platform: string;
    quality: string;
    searchQuery: {
      keyword: string;
      platform: string;
      quality: string;
    } | null;
    searchPage: number;
    searchTotal: number;
    searchResults: Array<Record<string, unknown>>;
  };
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

function installSearchDom() {
  const results = { innerHTML: '', querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []) };
  const total = { textContent: '' };
  const pagination = { innerHTML: '' };
  const selectors = new Map<string, unknown>([
    ['[data-role="search-results"]', results],
    ['[data-role="search-total"]', total],
    ['[data-role="search-pagination"]', pagination],
  ]);

  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => selectors.get(selector) ?? null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return { results, total, pagination };
}

async function loadModules() {
  const searchModulePath = '../../static/js/music_modules/search.js';
  const stateModulePath = '../../static/js/state.js';
  const search = await import(searchModulePath) as SearchModule;
  const stateModule = await import(stateModulePath) as StateModule;
  return { search, state: stateModule.state };
}

describe('music search module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests search results with the active quality and paginates them', async () => {
    const { results, total, pagination } = installSearchDom();
    const fetchMock = vi.fn(async () => okResponse({
      list: [{
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        source_data: { platform: 'kw', quality: 'flac24bit' },
      }],
      total: 41,
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { search, state } = await loadModules();
    state.platform = 'kw';
    state.quality = '320k';
    state.searchQuery = {
      keyword: '晴天',
      platform: 'kw',
      quality: 'flac24bit',
    };

    await search.loadSearchPage(2);

    expect(fetchMock).toHaveBeenCalledWith('api/music/search', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        keyword: '晴天',
        source_id: 'kw',
        quality: 'flac24bit',
        page: 2,
        page_size: 20,
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(state.searchPage).toBe(2);
    expect(state.searchTotal).toBe(41);
    expect(state.searchResults).toHaveLength(1);
    expect(total.textContent).toBe('41');
    expect(results.innerHTML).toContain('晴天');
    expect(pagination.innerHTML).toContain('data-pagination="search"');
    expect(pagination.innerHTML).toContain('第 2 / 3 页');
  });
});
