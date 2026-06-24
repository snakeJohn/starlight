import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeteaseProvider } from '../../src/music/platforms/providers/wy';

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

const originalCrypto = globalThis.crypto;

function wySong(id: number): Record<string, unknown> {
  return {
    id,
    name: `Song ${id}`,
    ar: [{ name: `Singer ${id}` }],
    al: { id: id + 1000, name: `Album ${id}`, picUrl: `https://img.test/${id}.jpg` },
    dt: 180000,
  };
}

describe('NeteaseProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('uses the lxserver eapi song search flow for Netease songs', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        md5: vi.fn(() => 'digest'),
        aesEncrypt: vi.fn(() => ({ toString: (format?: string) => format === 'hex' ? 'ENCODED' : 'ENCODED' })),
      },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('/eapi/search/song/list/page');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('params=ENCODED');
      return okJson({
        code: 200,
        data: {
          totalCount: 1,
          resources: [{
            baseInfo: {
              simpleSongData: {
                id: 1001,
                name: '风起天阑',
                ar: [{ name: '河图' }],
                al: { id: 2001, name: '风起天阑', picUrl: 'https://img.test/wy.jpg' },
                dt: 301000,
                privilege: { maxbr: 320000 },
              },
            },
          }],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NeteaseProvider().search('风起天阑 河图', 1, 5);

    expect(result).toMatchObject({
      total: 1,
      list: [{
        title: '风起天阑',
        artist: '河图',
        album: '风起天阑',
        cover_url: 'https://img.test/wy.jpg',
      }],
    });
  });

  it('uses the lxserver eapi playlist search flow for Netease playlists', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        md5: vi.fn(() => 'digest'),
        aesEncrypt: vi.fn(() => ({ toString: (format?: string) => format === 'hex' ? 'ENCODED' : 'ENCODED' })),
      },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('/eapi/cloudsearch/pc');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('params=ENCODED');
      return okJson({
        code: 200,
        result: {
          playlistCount: 1,
          playlists: [{
            id: 3001,
            name: '河图精选',
            coverImgUrl: 'https://img.test/wy-list.jpg',
            playCount: 88,
            description: '古风歌单',
          }],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NeteaseProvider().songListSearch('河图', 1, 10);

    expect(result).toEqual({
      total: 1,
      list: [{
        id: '3001',
        name: '河图精选',
        cover_url: 'https://img.test/wy-list.jpg',
        play_count: 88,
        description: '古风歌单',
      }],
    });
  });

  it('loads playlist pages from trackIds when playlist tracks only contains the first 10 songs', async () => {
    const trackIds = Array.from({ length: 75 }, (_, index) => ({ id: index + 1 }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v6/playlist/detail')) {
        return okJson({
          playlist: {
            name: 'Snake Yu',
            coverImgUrl: 'https://img.test/wy-list.jpg',
            trackCount: 75,
            trackIds,
            tracks: trackIds.slice(0, 10).map((item) => wySong(item.id)),
          },
        });
      }
      if (url.includes('/api/song/detail')) {
        const ids = JSON.parse(decodeURIComponent(url.match(/ids=([^&]+)/)?.[1] || '[]')) as number[];
        return okJson({ songs: ids.map(wySong) });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NeteaseProvider().songListDetail('8282362946', 1, 50);

    expect(result.total).toBe(75);
    expect(result.name).toBe('Snake Yu');
    expect(result.cover_url).toBe('https://img.test/wy-list.jpg');
    expect(result.songs).toHaveLength(50);
    expect(result.songs[49]).toMatchObject({
      title: 'Song 50',
      artist: 'Singer 50',
      cover_url: 'https://img.test/50.jpg',
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/song/detail'))).toBe(true);
  });
});
