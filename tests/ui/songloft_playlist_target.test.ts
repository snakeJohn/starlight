import { afterEach, describe, expect, it, vi } from 'vitest';

interface SongloftPlaylistTargetModule {
  openSongloftPlaylistTarget(songs: Array<Record<string, unknown>>, options?: Record<string, unknown>): Promise<void>;
  submitSongloftPlaylistTarget(): Promise<unknown>;
}

interface StateModule {
  state: {
    songloftTargetPlaylistId: string;
    songloftTargetPendingSongs: Array<Record<string, unknown>>;
  };
}

const song = {
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  duration: 200,
  cover_url: 'https://img.test/song.jpg',
  source_data: {
    platform: 'kw',
    quality: '320k',
    songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: '123' },
  },
};

const okResponse = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => ({ success: true, data }),
});

function installTargetDom() {
  const dialog = { hidden: true, setAttribute: vi.fn(), removeAttribute: vi.fn() };
  const select = { innerHTML: '', value: '', addEventListener: vi.fn() };
  const filter = { value: '', addEventListener: vi.fn() };
  const name = { value: '', focus: vi.fn(), addEventListener: vi.fn() };
  const count = { textContent: '' };
  const form = { addEventListener: vi.fn(), reset: vi.fn() };
  const refresh = { addEventListener: vi.fn(), disabled: false };
  const cancel = { addEventListener: vi.fn() };
  const confirm = { addEventListener: vi.fn(), disabled: false };
  const node = { className: '', textContent: '', remove: vi.fn() };
  const selectors = new Map<string, unknown>([
    ['[data-role="songloft-playlist-target-dialog"]', dialog],
    ['[data-role="songloft-target-playlist-select"]', select],
    ['[data-role="songloft-target-playlist-filter"]', filter],
    ['[data-role="songloft-target-playlist-name"]', name],
    ['[data-role="songloft-target-song-count"]', count],
    ['[data-role="songloft-playlist-target-form"]', form],
    ['[data-action="refresh-songloft-target-playlists"]', refresh],
    ['[data-action="cancel-songloft-target"]', cancel],
    ['[data-action="confirm-songloft-target"]', confirm],
    ['.toast', null],
  ]);

  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => selectors.get(selector) ?? null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => node),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return { dialog, select, filter, name, count, form, confirm };
}

async function loadModules() {
  const target = await import('../../static/js/music_modules/songloft_playlist_target.js') as SongloftPlaylistTargetModule;
  const stateModule = await import('../../static/js/state.js') as StateModule;
  return { target, state: stateModule.state };
}

describe('Songloft target playlist picker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens by loading Songloft playlists and recording pending songs', async () => {
    const { dialog, select, count } = installTargetDom();
    const fetchMock = vi.fn(async () => okResponse({
      list: [{ id: 12, name: 'Road Trip' }],
      total: 1,
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { target, state } = await loadModules();

    await target.openSongloftPlaylistTarget([song]);

    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists', expect.any(Object));
    expect(dialog.hidden).toBe(false);
    expect(select.innerHTML).toContain('Road Trip');
    expect(select.value).toBe('12');
    expect(count.textContent).toContain('1');
    expect(state.songloftTargetPendingSongs).toEqual([song]);
  });

  it('submits pending songs to the selected Songloft playlist', async () => {
    const { select } = installTargetDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists') {
        return okResponse({ list: [{ id: 12, name: 'Road Trip' }], total: 1 }) as Response;
      }
      if (url === 'api/songloft/playlists/import-songs/jobs') {
        return okResponse({ started: true, job_id: 'job-1', status: 'running', type: 'songs' }, 202) as Response;
      }
      if (url === 'api/songloft/playlists/import-jobs/job-1') {
        return okResponse({ id: 'job-1', status: 'done', result: { playlist: { id: 12 }, imported: 1, added: 1, skipped: 0, errors: [] } }) as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { target, state } = await loadModules();

    await target.openSongloftPlaylistTarget([song]);
    select.value = '12';
    await target.submitSongloftPlaylistTarget();

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const importCall = calls.find(([url]) => url === 'api/songloft/playlists/import-songs/jobs');
    expect(importCall).toBeTruthy();
    expect(JSON.parse(String(importCall?.[1]?.body))).toEqual({
      playlist_id: '12',
      songs: [song],
    });
    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists/import-jobs/job-1', expect.any(Object));
    expect(state.songloftTargetPlaylistId).toBe('12');
  });

  it('returns immediately after starting a Songloft import job', async () => {
    const { dialog, select, confirm } = installTargetDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists') {
        return okResponse({ list: [{ id: 12, name: 'Road Trip' }], total: 1 }) as Response;
      }
      if (url === 'api/songloft/playlists/import-songs/jobs') {
        return okResponse({ started: true, job_id: 'slow-job', status: 'running', type: 'songs' }, 202) as Response;
      }
      if (url === 'api/songloft/playlists/import-jobs/slow-job') {
        return new Promise(() => {}) as Promise<Response>;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { target, state } = await loadModules();

    await target.openSongloftPlaylistTarget([song]);
    select.value = '12';
    const result = await Promise.race([
      target.submitSongloftPlaylistTarget().then(() => 'submitted'),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 25)),
    ]);

    expect(result).toBe('submitted');
    expect(dialog.hidden).toBe(true);
    expect(confirm.disabled).toBe(false);
    expect(state.songloftTargetPendingSongs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists/import-jobs/slow-job', expect.any(Object));
  });
});
