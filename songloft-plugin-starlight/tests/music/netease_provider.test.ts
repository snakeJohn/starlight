import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeteaseProvider } from '../../src/music/platforms/providers/wy';

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

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
