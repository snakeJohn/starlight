import { afterEach, describe, expect, it, vi } from 'vitest';
import { KugouProvider } from '../../src/music/platforms/providers/kg';

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

describe('KugouProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads leaderboard songs from the mobile rank API', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => okJson({
      errcode: 0,
      data: {
        total: 500,
        info: [{
          songname: '你有没有真的爱过我',
          remark: '你有没有真的爱过我',
          authors: [{ author_name: '阿图表妹' }],
          duration: 243,
          audio_id: 12345,
          hash: 'hash-128',
          '320hash': 'hash-320',
          sqhash: 'hash-flac',
          album_id: 190170015,
          album_sizable_cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg',
          filesize: 3943680,
          '320filesize': 9749118,
          sqfilesize: 29370943,
        }],
      },
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KugouProvider().leaderboardList('kg__8888', 1, 5);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');

    expect(requestedUrl).toContain('mobilecdnbj.kugou.com/api/v3/rank/song');
    expect(requestedUrl).toContain('rankid=8888');
    expect(result.total).toBe(500);
    expect(result.songs[0]).toMatchObject({
      title: '你有没有真的爱过我',
      artist: '阿图表妹',
      album: '你有没有真的爱过我',
      duration: 243,
      cover_url: 'http://imge.kugou.com/stdmusic/400/cover.jpg',
      source_data: {
        platform: 'kg',
        songInfo: expect.objectContaining({
          hash: 'hash-128',
          songmid: '12345',
        }),
      },
    });
  });

  it('loads gcid songlist links through Kugou global collection APIs', async () => {
    vi.stubGlobal('crypto', { md5: vi.fn(() => 'kg-sign') });
    const link = 'https://m.kugou.com/songlist/gcid_3z90yglfz6z01f/?src_cid=3z90yglfz6z01f&uid=474174975&chl=message&iszlist=1';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/songlist/batch_decode')) {
        expect(String(init?.body)).toContain('gcid_3z90yglfz6z01f');
        return okJson({ data: { list: [{ global_collection_id: 'collection_3_474174975_6_0' }] } });
      }
      if (url.includes('/api/v5/special/info_v2')) {
        return okJson({
          data: {
            specialname: '古风民谣',
            imgurl: 'https://img.test/{size}/songlist.jpg',
            songcount: 296,
          },
        });
      }
      if (url.includes('/api/v5/special/song_v2')) {
        expect(url).toContain('global_specialid=collection_3_474174975_6_0');
        return okJson({
          data: {
            total: 290,
            info: [{
              filename: '太一 - 负重一万斤长大',
              remark: '第一次做人',
              duration: 262,
              audio_id: 7788,
              hash: 'kg-hash-128',
              trans_param: { union_cover: 'https://img.test/{size}/kg-song.jpg' },
              filesize: 1024,
            }],
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KugouProvider().songListDetail(link, 1, 30);

    expect(result).toMatchObject({
      name: '古风民谣',
      total: 296,
      cover_url: 'https://img.test/400/songlist.jpg',
      songs: [{
        title: '负重一万斤长大',
        artist: '太一',
        album: '第一次做人',
        cover_url: 'https://img.test/400/kg-song.jpg',
      }],
    });
  });
});
