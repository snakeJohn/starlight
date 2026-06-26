import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeService } from '../../src/bridge/service';
import { SongloftPlaylistService } from '../../src/songloft/playlist_service';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { SearchResultSong } from '../../src/music/types';

const song = {
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  duration: 200,
  cover_url: 'https://img.test/song.jpg',
  source_data: {
    platform: 'kw',
    quality: '320k',
    songInfo: {
      source: 'kw',
      name: 'Song',
      singer: 'Singer',
      album: 'Album',
      duration: 200,
      musicId: '123',
    },
  },
} satisfies SearchResultSong;

const secondSong = {
  ...song,
  title: 'Second Song',
  source_data: {
    ...song.source_data,
    songInfo: {
      ...song.source_data.songInfo,
      musicId: '456',
      name: 'Second Song',
    },
  },
} satisfies SearchResultSong;

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createBridge(result: any = {
  total: 1,
  skipped: 0,
  payloads: [],
  songs: [{ id: 101, title: 'Song', artist: 'Singer' }],
  errors: [],
}) {
  return {
    importSongsBestEffort: vi.fn(async () => result),
    resolveSearchSong: vi.fn(async () => null),
  } as unknown as BridgeService;
}

function createRegistry(provider?: MusicPlatformProvider): PlatformRegistry {
  return {
    get: vi.fn((id: string) => (provider && id === provider.id ? provider : null)),
  } as unknown as PlatformRegistry;
}

describe('SongloftPlaylistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (songloft.playlists as unknown as Record<string, unknown>).create;
    delete (songloft.playlists as unknown as Record<string, unknown>).addSongs;
  });

  it('creates playlists through the Songloft SDK when available', async () => {
    (songloft.playlists as unknown as Record<string, unknown>).create = vi.fn(async (input) => ({
      id: 12,
      name: (input as { name: string }).name,
    }));
    const bridge = createBridge();
    const service = new SongloftPlaylistService(bridge, createRegistry());

    await expect(service.createPlaylist('Road Trip')).resolves.toEqual({ id: 12, name: 'Road Trip' });

    expect((songloft.playlists as unknown as Record<string, any>).create).toHaveBeenCalledWith({ name: 'Road Trip' });
  });

  it('imports search songs and adds returned Songloft song ids to an existing playlist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:18191/api/v1/playlists/12/songs');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ song_ids: [101] });
      return responseJson({ added: 1, skipped: 0 });
    });
    globalThis.fetch = fetchMock;
    const bridge = createBridge();
    const service = new SongloftPlaylistService(bridge, createRegistry());

    await expect(service.importSongsToPlaylist({
      playlist_id: 12,
      songs: [song],
    })).resolves.toMatchObject({
      playlist: { id: 12 },
      imported: 1,
      added: 1,
      skipped: 0,
      errors: [],
    });

    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([song]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds songs through the Songloft host playlist API even if a non-public SDK addSongs exists', async () => {
    const sdkAddSongs = vi.fn(async () => ({ added: 1 }));
    (songloft.playlists as unknown as Record<string, unknown>).addSongs = sdkAddSongs;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:18191/api/v1/playlists/12/songs');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ song_ids: [101] });
      return responseJson({ added: 1 });
    });
    globalThis.fetch = fetchMock;
    const service = new SongloftPlaylistService(createBridge(), createRegistry());

    await expect(service.addSongIds(12, [101])).resolves.toMatchObject({
      playlist_id: 12,
      song_ids: [101],
      added: 1,
    });

    expect(sdkAddSongs).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves portable playlist songs before importing them into Songloft', async () => {
    const fetchMock = vi.fn(async () => responseJson({ added: 1 }));
    globalThis.fetch = fetchMock;
    const bridge = createBridge();
    (bridge.resolveSearchSong as ReturnType<typeof vi.fn>).mockResolvedValue(song);
    const service = new SongloftPlaylistService(bridge, createRegistry());

    await expect(service.importSongsToPlaylist({
      playlist_id: 12,
      songs: [{ title: 'Song', artist: 'Singer', album: '', duration: 0, cover_url: '' } as any],
    })).resolves.toMatchObject({
      imported: 1,
      added: 1,
      skipped: 0,
    });

    expect(bridge.resolveSearchSong).toHaveBeenCalledWith('Song', 'Singer');
    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([song]);
  });

  it('creates a target playlist by name before adding imported songs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/playlists')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'New Mix' });
        return responseJson({ id: 13, name: 'New Mix' }, 201);
      }
      if (url.endsWith('/api/v1/playlists/13/songs')) {
        expect(JSON.parse(String(init?.body))).toEqual({ song_ids: [101] });
        return responseJson({ added: 1 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const bridge = createBridge();
    const service = new SongloftPlaylistService(bridge, createRegistry());

    await expect(service.importSongsToPlaylist({
      playlist_name: 'New Mix',
      songs: [song],
    })).resolves.toMatchObject({
      playlist: { id: 13, name: 'New Mix' },
      imported: 1,
      added: 1,
    });
  });

  it('loads every external songlist page, creates a playlist, and adds imported songs', async () => {
    const provider = {
      id: 'kw',
      name: '酷我',
      songListDetail: vi.fn(async (_id: string, page: number, pageSize: number) => ({
        name: 'Network Mix',
        total: 2,
        songs: page === 1 ? [song] : page === 2 ? [secondSong] : [],
      })),
    } as unknown as MusicPlatformProvider;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/playlists')) {
        return responseJson({ id: 14, name: 'Network Mix' }, 201);
      }
      if (url.endsWith('/api/v1/playlists/14/songs')) {
        expect(JSON.parse(String(init?.body))).toEqual({ song_ids: [101, 102] });
        return responseJson({ added: 2 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const bridge = createBridge({
      total: 2,
      skipped: 0,
      payloads: [],
      songs: [{ id: 101 }, { id: 102 }],
      errors: [],
    });
    const service = new SongloftPlaylistService(bridge, createRegistry(provider));

    await expect(service.importSourceSonglist({
      source_id: 'kw',
      id: '3360244412',
      quality: 'flac24bit',
    })).resolves.toMatchObject({
      playlist: { id: 14, name: 'Network Mix' },
      source_total: 2,
      imported: 2,
      added: 2,
      skipped: 0,
    });

    expect(provider.songListDetail).toHaveBeenNthCalledWith(1, '3360244412', 1, 100);
    expect(provider.songListDetail).toHaveBeenNthCalledWith(2, '3360244412', 2, 100);
    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([
      expect.objectContaining({ source_data: expect.objectContaining({ quality: 'flac24bit' }) }),
      expect.objectContaining({ source_data: expect.objectContaining({ quality: 'flac24bit' }) }),
    ]);
  });
});
