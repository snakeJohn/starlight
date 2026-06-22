import { afterEach, describe, expect, it, vi } from 'vitest';

interface CustomPlaylistUiModule {
  renderSongRow(song: Record<string, unknown>, index: number, extraActions?: string): string;
  renderCustomPlaylistItem(playlist: Record<string, unknown>): string;
  addSongToCustomPlaylist(playlistId: string, song: Record<string, unknown>): Promise<unknown>;
  importCustomPlaylistFromSource(sourceId: string, listId: string): Promise<unknown>;
  refreshCustomPlaylist(playlistId: string): Promise<unknown>;
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

function installToastDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => node),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
}

async function loadMusicModule(): Promise<CustomPlaylistUiModule> {
  const modulePath = '../../static/js/music.js';
  return await import(modulePath) as CustomPlaylistUiModule;
}

describe('custom playlist music UI helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adds a custom playlist action to song rows', async () => {
    const { renderSongRow } = await loadMusicModule();

    const html = renderSongRow({
      title: '稻花香',
      artist: '周杰伦',
      album: '魔杰座',
      source_data: { platform: 'kw', quality: '320k' },
    }, 0);

    expect(html).toContain('加入歌单');
    expect(html).toContain('data-action="add-to-playlist"');
  });

  it('posts selected songs into a custom playlist', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'custom_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { addSongToCustomPlaylist } = await loadMusicModule();
    const song = { title: '为龙', source_data: { platform: 'kg', quality: '320k', songInfo: {} } };

    await addSongToCustomPlaylist('custom_1', song);

    expect(fetchMock).toHaveBeenCalledWith('api/custom-playlists/custom_1/songs', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ song }),
    }));
  });

  it('imports and refreshes LX Server-style playlists through custom playlist APIs', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'imported_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { importCustomPlaylistFromSource, refreshCustomPlaylist } = await loadMusicModule();

    await importCustomPlaylistFromSource('kw', '3360244412');
    await refreshCustomPlaylist('imported_1');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('api/custom-playlists/import');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      source_id: 'kw',
      id: '3360244412',
    });
    expect(calls.map((call) => call[0])).toContain('api/custom-playlists/imported_1/refresh');
  });

  it('renders imported playlist metadata without exposing upstream ids', async () => {
    const { renderCustomPlaylistItem } = await loadMusicModule();

    const html = renderCustomPlaylistItem({
      id: 'imported_1',
      name: '酷我歌单',
      cover_url: 'https://img.test/list.jpg',
      source: 'kw',
      source_name: '酷我',
      sourceListId: '3360244412',
      songs: [{ title: '稻花香', artist: '周杰伦', source_name: '酷我' }],
    });

    expect(html).toContain('https://img.test/list.jpg');
    expect(html).toContain('酷我歌单');
    expect(html).toContain('酷我');
    expect(html).toContain('刷新');
    expect(html).not.toContain('3360244412');
  });
});
