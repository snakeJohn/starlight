import { afterEach, describe, expect, it, vi } from 'vitest';
import { QQMusicProvider } from '../../src/music/platforms/providers/tx';

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

describe('QQMusicProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads QQ playlist links with total count and cover metadata', async () => {
    const link = 'https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=8146949614&hosteuin=';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain('fcg_ucc_getcdinfo_byids_cp.fcg');
      expect(url).toContain('disstid=8146949614');
      expect(init?.headers).toMatchObject({
        Origin: 'https://y.qq.com',
      });
      return okJson({
        code: 0,
        cdlist: [{
          dissname: '民谣',
          logo: 'https://img.test/qq-list.jpg',
          total_song_num: 140,
          songlist: [{
            id: 1001,
            mid: 'song-mid-1',
            name: '窗',
            singer: [{ name: '虎二' }],
            album: { id: 2001, mid: 'album-mid-1', name: '窗' },
            interval: 181,
            file: { media_mid: 'media-mid-1' },
          }],
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new QQMusicProvider().songListDetail(link, 1, 50);

    expect(result).toMatchObject({
      name: '民谣',
      total: 140,
      cover_url: 'https://img.test/qq-list.jpg',
      songs: [{
        title: '窗',
        artist: '虎二',
        cover_url: 'https://y.gtimg.cn/music/photo_new/T002R500x500M000album-mid-1.jpg',
      }],
    });
  });
});
