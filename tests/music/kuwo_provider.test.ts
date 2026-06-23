import { afterEach, describe, expect, it, vi } from 'vitest';
import { KuwoProvider } from '../../src/music/platforms/providers/kw';

function response(text: string): Response {
  return new Response(text, { status: 200 });
}

describe('KuwoProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fills ranking song covers from album info when rank rows have only album IDs', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('kbangserver.kuwo.cn')) {
        return response(JSON.stringify({
          num: 1,
          musiclist: [{
            id: '1118438',
            name: '父亲',
            artist: '筷子兄弟',
            album: '父亲',
            albumid: '83891',
            song_duration: '280',
            formats: 'MP3128|MP3H|ALFLAC',
          }],
        }));
      }
      if (url.includes('stype=albuminfo') && url.includes('albumid=83891')) {
        return response("{'albumid':'83891','img':'http://img3.sycdn.kuwo.cn/star/albumcover/240/44/10/2400396154.jpg','hts_img':'https://img1.kuwo.cn/star/albumcover/240/44/10/2400396154.jpg'}");
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().leaderboardList('kw__93', 1, 1);

    expect(result.songs[0]).toMatchObject({
      title: '父亲',
      artist: '筷子兄弟',
      cover_url: 'https://img1.kuwo.cn/star/albumcover/240/44/10/2400396154.jpg',
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('stype=albuminfo'))).toBe(true);
  });

  it('loads Kuwo playlist_detail links with total count and cover metadata', async () => {
    const link = 'https://www.kuwo.cn/playlist_detail/3596743037';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain('nplserver.kuwo.cn/pl.svc');
      expect(url).toContain('pid=3596743037');
      expect(url).toContain('pn=0');
      expect(url).toContain('rn=5');
      return response(JSON.stringify({
        result: 'ok',
        total: 126,
        title: '英文流行｜好听又治愈的欧美歌曲',
        pic: 'https://img.test/kw-list.jpg',
        musiclist: [{
          MUSICRID: 'MUSIC_1',
          SONGNAME: 'Empty Love',
          ARTIST: 'Lulleaux',
          ALBUM: 'Empty Love',
          DURATION: 180,
          albumpic: 'https://img.test/kw-song.jpg',
        }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().songListDetail(link, 1, 5);

    expect(result).toMatchObject({
      name: '英文流行｜好听又治愈的欧美歌曲',
      total: 126,
      cover_url: 'https://img.test/kw-list.jpg',
      songs: [{
        title: 'Empty Love',
        artist: 'Lulleaux',
        cover_url: 'https://img.test/kw-song.jpg',
      }],
    });
  });
});
