import { afterEach, describe, expect, test, vi } from 'vitest';
import { MiguProvider } from '../../src/music/platforms/providers/mg';

const originalCrypto = globalThis.crypto;

describe('MiguProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  test('sends a deterministic non-empty Migu search signature', async () => {
    const now = 1_764_543_210_000;
    const keyword = 'starlight';
    const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
    const signaturePayload = `${keyword}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${now}`;
    const expectedSign = 'de6820338dd3d400b63476c4fe366f4a';
    const cryptoMd5 = vi.fn((value: string) => (value === signaturePayload ? expectedSign : 'unexpected-signature-input'));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ songResultData: { resultList: [], totalCount: 0 } })));

    vi.spyOn(Date, 'now').mockReturnValue(now);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new MiguProvider().search(keyword, 2, 30);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cryptoMd5).toHaveBeenCalledWith(signaturePayload);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toBeDefined();
    if (!init) {
      throw new Error('Expected Migu search to pass request options');
    }
    expect(init.headers).toMatchObject({
      timestamp: String(now),
      deviceId,
      sign: expectedSign,
    });
    expect((init.headers as Record<string, string>).sign).not.toBe('');
  });

  test('resolves c.migu.cn short playlist links before loading songs', async () => {
    const shortLink = 'https://c.migu.cn/00DbQM?ifrom=45400458358ff67ed138b9dbdc4c3c9b';
    const finalUrl = 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=234913063&channel=0146921&appId=music';
    const cryptoMd5 = vi.fn(() => 'migu-sign');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === shortLink) {
        const response = new Response('', { status: 200 });
        Object.defineProperty(response, 'url', { configurable: true, value: finalUrl });
        return response;
      }
      if (url.includes('playlist/song/v2.0')) {
        return new Response(JSON.stringify({
          data: {
            totalCount: 1,
            songList: [{
              name: '稻花香',
              singerList: [{ name: '周杰伦' }],
              album: '魔杰座',
              duration: 180,
              img1: '/cover.jpg',
              songId: 'mg-song-1',
            }],
          },
        }));
      }
      if (url.includes('resource/playlist/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            title: '测试歌单',
            imgItem: { img: 'https://img.test/mg-list.jpg' },
            summary: '咪咕测试',
          },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new MiguProvider().songListDetail(shortLink, 1, 30);

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(shortLink);
    expect(String(fetchMock.mock.calls[1][0])).toContain('playlistId=234913063');
    expect(result).toMatchObject({
      name: '测试歌单',
      cover_url: 'https://img.test/mg-list.jpg',
      total: 1,
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
        cover_url: 'http://d.musicapp.migu.cn/cover.jpg',
      }],
    });
  });

  test('resolves Migu short playlist links from redirect location headers when response.url is unchanged', async () => {
    const shortLink = 'https://c.migu.cn/00DbQM?ifrom=45400458358ff67ed138b9dbdc4c3c9b';
    const location = 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=234913063&channel=0146921&appId=music';
    const cryptoMd5 = vi.fn(() => 'migu-sign');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === shortLink) {
        expect(init?.redirect).toBe('manual');
        return new Response('', {
          status: 302,
          headers: { location },
        });
      }
      if (url.includes('playlist/song/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          data: {
            totalCount: 1,
            songList: [{
              name: '稻花香',
              singerList: [{ name: '周杰伦' }],
              album: '魔杰座',
              duration: 180,
              img1: '/cover.jpg',
              songId: 'mg-song-1',
            }],
          },
        }));
      }
      if (url.includes('resource/playlist/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            title: '测试歌单',
            imgItem: { img: 'https://img.test/mg-list.jpg' },
          },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new MiguProvider().songListDetail(shortLink, 1, 30);

    expect(result).toMatchObject({
      name: '测试歌单',
      cover_url: 'https://img.test/mg-list.jpg',
      total: 1,
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
      }],
    });
  });

  test('resolves Migu short playlist links when runtime only exposes a case-sensitive Location header', async () => {
    const shortLink = 'https://c.migu.cn/00DbQM?ifrom=45400458358ff67ed138b9dbdc4c3c9b';
    const location = 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=234913063&channel=0146921&appId=music';
    const cryptoMd5 = vi.fn(() => 'migu-sign');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === shortLink) {
        if (init?.redirect === 'manual') {
          return {
            ok: false,
            status: 302,
            url,
            headers: {
              get(name: string) {
                return name === 'Location' ? location : null;
              },
            },
            text: async () => '',
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 302,
          url,
          headers: {
            get() {
              return null;
            },
          },
          text: async () => '',
        } as unknown as Response;
      }
      if (url.includes('playlist/song/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          data: {
            totalCount: 1,
            songList: [{
              name: '稻花香',
              singerList: [{ name: '周杰伦' }],
              album: '魔杰座',
              duration: 180,
              img1: '/cover.jpg',
              songId: 'mg-song-1',
            }],
          },
        }));
      }
      if (url.includes('resource/playlist/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            title: '测试歌单',
            imgItem: { img: 'https://img.test/mg-list.jpg' },
          },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new MiguProvider().songListDetail(shortLink, 1, 30);

    expect(result).toMatchObject({
      name: '测试歌单',
      cover_url: 'https://img.test/mg-list.jpg',
      total: 1,
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
      }],
    });
  });

  test('resolves Migu short playlist links when the runtime only honors X-Fetch-No-Redirect headers', async () => {
    const shortLink = 'https://c.migu.cn/00DbQM?ifrom=45400458358ff67ed138b9dbdc4c3c9b';
    const location = 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=234913063&channel=0146921&appId=music';
    const cryptoMd5 = vi.fn(() => 'migu-sign');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      if (url === shortLink) {
        if (headers['X-Fetch-No-Redirect'] === '1') {
          return {
            ok: false,
            status: 302,
            url: '',
            headers: {
              Location: location,
            },
            text: async () => '',
          } as unknown as Response;
        }
        if (init?.redirect === 'manual') {
          return {
            ok: true,
            status: 200,
            url: '',
            headers: {},
            text: async () => '<html></html>',
          } as unknown as Response;
        }
        const response = new Response('<html></html>', { status: 200 });
        Object.defineProperty(response, 'url', { configurable: true, value: shortLink });
        return response;
      }
      if (url.includes('playlist/song/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          data: {
            totalCount: 1,
            songList: [{
              name: '稻花香',
              singerList: [{ name: '周杰伦' }],
              album: '魔杰座',
              duration: 180,
              img1: '/cover.jpg',
              songId: 'mg-song-1',
            }],
          },
        }));
      }
      if (url.includes('resource/playlist/v2.0')) {
        expect(url).toContain('playlistId=234913063');
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            title: '测试歌单',
            imgItem: { img: 'https://img.test/mg-list.jpg' },
          },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new MiguProvider().songListDetail(shortLink, 1, 30);

    expect(fetchMock).toHaveBeenCalledWith(shortLink, expect.objectContaining({
      headers: expect.objectContaining({ 'X-Fetch-No-Redirect': '1' }),
    }));
    expect(result).toMatchObject({
      name: '测试歌单',
      cover_url: 'https://img.test/mg-list.jpg',
      total: 1,
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
      }],
    });
  });

  test('uses mobile web headers for Migu playlist detail endpoints that reject signed-only requests', async () => {
    const shortLink = 'https://c.migu.cn/00DbQM?ifrom=45400458358ff67ed138b9dbdc4c3c9b';
    const finalUrl = 'https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=234913063&channel=0146921&appId=music';
    const cryptoMd5 = vi.fn(() => 'migu-sign');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      if (url === shortLink) {
        const response = new Response('', { status: 200 });
        Object.defineProperty(response, 'url', { configurable: true, value: finalUrl });
        return response;
      }
      if (url.includes('playlist/song/v2.0')) {
        if (headers.Referer !== 'https://m.music.migu.cn/') {
          return new Response(JSON.stringify({ code: '199997', info: 'timestamp不对' }));
        }
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            totalCount: 1,
            songList: [{
              name: '稻花香',
              singerList: [{ name: '周杰伦' }],
              album: '魔杰座',
              duration: 180,
              img1: '/cover.jpg',
              songId: 'mg-song-1',
            }],
          },
        }));
      }
      if (url.includes('resource/playlist/v2.0')) {
        if (headers.Referer !== 'https://m.music.migu.cn/') {
          return new Response(JSON.stringify({ code: '199997', info: 'timestamp不对' }));
        }
        return new Response(JSON.stringify({
          code: '000000',
          data: {
            title: '测试歌单',
            imgItem: { img: 'https://img.test/mg-list.jpg' },
          },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new MiguProvider().songListDetail(shortLink, 1, 30);

    expect(result).toMatchObject({
      name: '测试歌单',
      cover_url: 'https://img.test/mg-list.jpg',
      total: 1,
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
      }],
    });
  });
});
