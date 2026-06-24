import { afterEach, describe, expect, it, vi } from 'vitest';
import { KuwoProvider } from '../../src/music/platforms/providers/kw';

function response(text: string, status = 200): Response {
  return new Response(text, { status });
}

describe('KuwoProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ignores numeric placeholder covers and falls back to web_albumpic_short', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain('search.kuwo.cn/r.s');
      return response(JSON.stringify({
        TOTAL: '1',
        abslist: [{
          MUSICRID: 'MUSIC_62355680',
          SONGNAME: '风起天阑',
          ARTIST: '河图',
          ALBUM: '风起天阑',
          DURATION: 301,
          pic: '1',
          albumpic: '2',
          prob_albumpic: '3',
          web_albumpic_short: '/44/10/2400396154.jpg',
        }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().search('风起天阑 河图', 1, 5);

    expect(result.list[0]).toMatchObject({
      title: '风起天阑',
      artist: '河图',
      cover_url: 'https://img4.kuwo.cn/star/albumcover/1000/44/10/2400396154.jpg',
    });
  });

  it('uses SUBLIST cover metadata when Kuwo search rows only expose sized short cover paths there', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain('search.kuwo.cn/r.s');
      return response(JSON.stringify({
        TOTAL: '1',
        abslist: [{
          MUSICRID: 'MUSIC_51415073',
          SONGNAME: '风起天阑',
          ARTIST: '河图',
          ALBUM: '倾尽天下',
          DURATION: 301,
          SUBLIST: [{
            web_albumpic_short: '120/s4s51/83/969487567.jpg',
          }],
        }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().search('风起天阑 河图', 1, 5);

    expect(result.list[0]).toMatchObject({
      title: '风起天阑',
      artist: '河图',
      cover_url: 'https://img4.kuwo.cn/star/albumcover/120/s4s51/83/969487567.jpg',
    });
  });

  it('normalizes artistpicserver cover fallbacks for Kuwo search rows without usable direct covers', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('search.kuwo.cn/r.s')) {
        return response(JSON.stringify({
          TOTAL: '1',
          abslist: [{
            MUSICRID: 'MUSIC_595898177',
            SONGNAME: '踏马寻花向自由 (雷鬼版)',
            ARTIST: '超哥',
            ALBUM: '踏马寻花向自由（雷鬼版）',
            DURATION: 179,
            pic: '1',
            albumpic: '',
            prob_albumpic: '',
            web_albumpic_short: '',
          }],
        }));
      }
      if (url.includes('artistpicserver.kuwo.cn/pic.web') && url.includes('rid=595898177')) {
        return response('http://img1.kuwo.cn/star/starheads/1000/9/47/3225410740.jpg');
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().search('踏马寻花向自由 超哥', 1, 5);

    expect(result.list[0]).toMatchObject({
      title: '踏马寻花向自由 (雷鬼版)',
      artist: '超哥',
      cover_url: 'http://img1.kuwo.cn/star/starheads/120/9/47/3225410740.jpg',
    });
  });

  it('loads Kuwo playlist_detail links with total count and cover metadata', async () => {
    const link = 'https://www.kuwo.cn/playlist_detail/3596743037';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('artistpicserver.kuwo.cn')) {
        return response('NO_PIC');
      }
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

  it('falls back to Kuwo rid cover lookup for playlist songs when album covers are stale', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('nplserver.kuwo.cn/pl.svc')) {
        return response(JSON.stringify({
          result: 'ok',
          total: 1,
          title: '河图',
          pic: 'https://img.test/kw-list.jpg',
          musiclist: [{
            MUSICRID: 'MUSIC_80071363',
            SONGNAME: '两生契',
            ARTIST: '河图',
            ALBUM: '河图精选',
            DURATION: 233,
            albumpic: 'http://img4.kuwo.cn/star/albumcover/120/s4s45/80/3271716362.jpg',
          }],
        }));
      }
      if (url.includes('artistpicserver.kuwo.cn/pic.web') && url.includes('rid=80071363')) {
        return response('http://img1.kwcdn.kuwo.cn/star/albumcover/700/47/20/1695471835.jpg');
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().songListDetail('3707184951', 1, 5);

    expect(result.songs[0]).toMatchObject({
      title: '两生契',
      artist: '河图',
      cover_url: 'http://img1.kwcdn.kuwo.cn/star/albumcover/700/47/20/1695471835.jpg',
    });
  });

  it('loads Kuwo leaderboard songs from kbangserver and normalizes rid cover fallbacks', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('kbangserver.kuwo.cn/ksong.s')) {
        return response(JSON.stringify({
          num: 1,
          musiclist: [{
            id: '595898177',
            name: '踏马寻花向自由 (雷鬼版)',
            artist: '超哥',
            album: '踏马寻花向自由（雷鬼版）',
            albumid: '94558104',
            duration: '179',
          }],
        }));
      }
      if (url.includes('artistpicserver.kuwo.cn/pic.web') && url.includes('rid=595898177')) {
        return response('http://img4.kuwo.cn/pic_music/700/s4s35/42/48939081.jpg');
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new KuwoProvider().leaderboardList('kw__93', 1, 1);

    expect(result).toMatchObject({
      total: 1,
      name: '飙升榜',
      songs: [{
        title: '踏马寻花向自由 (雷鬼版)',
        artist: '超哥',
        cover_url: 'http://img4.kuwo.cn/pic_music/120/s4s35/42/48939081.jpg',
      }],
    });
  });
});
