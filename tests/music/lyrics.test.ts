import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMusicLyric } from '../../src/music/platforms/lyrics';

const originalCrypto = globalThis.crypto;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

describe('resolveMusicLyric', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('decodes QQ lyrics and translated lyrics', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('fcg_query_lyric_new.fcg');
      return jsonResponse({
        code: 0,
        lyric: Buffer.from('[00:00.00]风起天阑').toString('base64'),
        trans: Buffer.from('[00:00.00]Wind rises').toString('base64'),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('tx', {
      source: 'tx',
      name: '风起天阑',
      singer: '河图',
      album: '风起天阑',
      duration: 301,
      songmid: 'tx-mid-1',
    });

    expect(result).toMatchObject({
      lyric: '[00:00.00]风起天阑',
      tlyric: '[00:00.00]Wind rises',
    });
  });

  it('uses Netease eapi lyric requests', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        md5: vi.fn(() => 'digest'),
        aesEncrypt: vi.fn(() => ({ toString: (format?: string) => format === 'hex' ? 'ENCODED' : 'ENCODED' })),
      },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('/eapi/song/lyric/v1');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('params=ENCODED');
      return jsonResponse({
        code: 200,
        lrc: { lyric: '[00:00.00]风起天阑' },
        tlyric: { lyric: '[00:00.00]Wind rises' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('wy', {
      source: 'wy',
      name: '风起天阑',
      singer: '河图',
      album: '风起天阑',
      duration: 301,
      songmid: '1001',
    });

    expect(result).toMatchObject({
      lyric: '[00:00.00]风起天阑',
      tlyric: '[00:00.00]Wind rises',
    });
  });

  it('parses Netease yrc word lyrics like lxserver', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        md5: vi.fn(() => 'digest'),
        aesEncrypt: vi.fn(() => ({ toString: (format?: string) => format === 'hex' ? 'ENCODED' : 'ENCODED' })),
      },
    });
    const fetchMock = vi.fn(async () => jsonResponse({
      code: 200,
      lrc: { lyric: '[00:00.00]Fallback' },
      yrc: { lyric: '[0,1000](0,500,0)Fall(500,500,0)back' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('wy', {
      source: 'wy',
      name: 'Fallback',
      singer: 'Artist',
      album: 'Album',
      duration: 200,
      songmid: '1002',
    });

    expect(result.lyric).toContain('Fallback');
    expect(result.lxlyric).toContain('[00:00.0]<0,500>Fall<500,500>back');
  });

  it('converts Kuwo lrclist responses into lrc text', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('songinfoandlrc?musicId=62355680');
      return jsonResponse({
        data: {
          songinfo: {
            songName: '风起天阑',
            artist: '河图',
            album: '风起天阑',
          },
          lrclist: [
            { time: '0.00', lineLyric: '风起天阑' },
            { time: '0.00', lineLyric: 'Wind rises' },
            { time: '5.00', lineLyric: '第二句' },
          ],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: '风起天阑',
      singer: '河图',
      album: '风起天阑',
      duration: 301,
      songmid: '62355680',
    });

    expect(result.lyric).toContain('[00:00.00]风起天阑');
    expect(result.tlyric).toContain('[00:00.00]Wind rises');
  });

  it('falls back to Kuwo legacy https lyrics when the http endpoint has no lyrics', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        throw new Error('binary lyric unavailable');
      }
      if (url.startsWith('http://m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          data: null,
          msg: '音乐查询失败',
          status: 301,
        });
      }
      if (url.startsWith('https://m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          data: {
            songinfo: { songName: '永定四十年', artist: '河图', album: 'NL不分' },
            lrclist: [
              { time: '0.00', lineLyric: '永定四十年 - 河图' },
              { time: '8.14', lineLyric: '词：Finale' },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: '永定四十年',
      singer: '河图',
      album: 'NL不分',
      duration: 280,
      songmid: '6905536',
    });

    expect(result.lyric).toContain('[ti:永定四十年]');
    expect(result.lyric).toContain('[00:08.14]词：Finale');
  });

  it('uses Kuwo openapi JSON lyrics when songinfoandlrc endpoints have no lyrics', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        throw new Error('binary lyric unavailable');
      }
      if (url.includes('/openapi/v1/www/lyric/getlyric')) {
        return jsonResponse({
          code: 200,
          msg: 'success',
          data: {
            lrclist: [
              { time: '0.0', lineLyric: '倾尽天下 - 河图' },
              { time: '13.1', lineLyric: '词：Finale' },
            ],
          },
        });
      }
      if (url.includes('/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          data: null,
          msg: '音乐查询失败',
          status: 301,
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: '倾尽天下',
      singer: '河图',
      album: '倾尽天下',
      duration: 265,
      songmid: '51415071',
    });

    expect(result.lyric).toContain('[ti:倾尽天下]');
    expect(result.lyric).toContain('[00:13.10]词：Finale');
  });

  it('uses Kuwo newlyric responses when the legacy lrc endpoint has no lyrics', async () => {
    const newlyricFixture = 'dHA9Y29udGVudA0KDQp4nFXJuw6CMBQA0F+yCSYwONxSrDylFS4to6CXmA4aEqn9ehM3z3pyipTcRjS7pz5L+5FqrYxvZs3iMIVIc6yfwvcF33Ylz6JXSmvVyJ5JPt9LIgHLmnGai2rZGsGt/R24/6P8mgF5G1QNxzgaHzmkPB6AL50JTWgdTj1LbsgQjdCdcagQvSlVjCm6ccAk7Y6IPa1noYt36/yIuK8vDKehy5MT2BKItbBABXA4fAH8+0TP';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        const bytes = Uint8Array.from(Buffer.from(newlyricFixture, 'base64'));
        return new Response(bytes.buffer, { status: 200 });
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          code: 301,
          msg: '音乐查询失败',
          data: { lrclist: [] },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: 'Fallback Song',
      singer: 'Fallback Artist',
      album: 'Fallback Album',
      duration: 200,
      musicId: '6905536',
    });

    expect(result.lyric).toContain('[00:00.000]Fallback');
    expect(result.lyric).not.toContain('<0,500>');
    expect(result.lxlyric).toContain('[00:00.000]');
    expect(result.lxlyric).toContain('<');
    expect(result.lxlyric).toContain('Fallback');
  });

  it('prefers browser base64 helpers when the plugin Buffer shim is incomplete', async () => {
    const originalBuffer = Buffer;
    const originalAtob = globalThis.atob;
    const originalBtoa = globalThis.btoa;
    const realBufferFrom = originalBuffer.from.bind(originalBuffer);
    const newlyricFixture = 'dHA9Y29udGVudA0KDQp4nFXJuw6CMBQA0F+yCSYwONxSrDylFS4to6CXmA4aEqn9ehM3z3pyipTcRjS7pz5L+5FqrYxvZs3iMIVIc6yfwvcF33Ylz6JXSmvVyJ5JPt9LIgHLmnGai2rZGsGt/R24/6P8mgF5G1QNxzgaHzmkPB6AL50JTWgdTj1LbsgQjdCdcagQvSlVjCm6ccAk7Y6IPa1noYt36/yIuK8vDKehy5MT2BKItbBABXA4fAH8+0TP';
    const bytes = Uint8Array.from(realBufferFrom(newlyricFixture, 'base64'));
    vi.stubGlobal('atob', (value: string) => realBufferFrom(value, 'base64').toString('binary'));
    vi.stubGlobal('btoa', (value: string) => realBufferFrom(value, 'binary').toString('base64'));
    const bufferFromSpy = vi.spyOn(originalBuffer, 'from').mockImplementation(() => {
      throw new Error('broken Buffer shim');
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => bytes.buffer,
          text: async () => '',
        } as unknown as Response;
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          code: 301,
          msg: '音乐查询失败',
          data: { lrclist: [] },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await resolveMusicLyric('kw', {
        source: 'kw',
        name: 'Fallback Song',
        singer: 'Fallback Artist',
        album: 'Fallback Album',
        duration: 200,
        musicId: '6905536',
      });

      expect(result.lyric).toContain('[00:00.000]Fallback');
      expect(result.lxlyric).toContain('[00:00.000]');
    } finally {
      bufferFromSpy.mockRestore();
      vi.stubGlobal('atob', originalAtob);
      vi.stubGlobal('btoa', originalBtoa);
    }
  });

  it('decodes Kuwo newlyric responses when fetch only exposes binary text', async () => {
    const newlyricFixture = 'dHA9Y29udGVudA0KDQp4nFXJuw6CMBQA0F+yCSYwONxSrDylFS4to6CXmA4aEqn9ehM3z3pyipTcRjS7pz5L+5FqrYxvZs3iMIVIc6yfwvcF33Ylz6JXSmvVyJ5JPt9LIgHLmnGai2rZGsGt/R24/6P8mgF5G1QNxzgaHzmkPB6AL50JTWgdTj1LbsgQjdCdcagQvSlVjCm6ccAk7Y6IPa1noYt36/yIuK8vDKehy5MT2BKItbBABXA4fAH8+0TP';
    const bytes = Uint8Array.from(Buffer.from(newlyricFixture, 'base64'));
    const binaryText = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        return {
          ok: true,
          status: 200,
          text: async () => binaryText,
        } as unknown as Response;
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          code: 301,
          msg: '音乐查询失败',
          data: { lrclist: [] },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: 'Fallback Song',
      singer: 'Fallback Artist',
      album: 'Fallback Album',
      duration: 200,
      musicId: '6905536',
    });

    expect(result.lyric).toContain('[00:00.000]Fallback');
    expect(result.lxlyric).toContain('[00:00.000]');
  });

  it('decodes Kuwo newlyric responses when fetch exposes raw Uint8Array body', async () => {
    const newlyricFixture = 'dHA9Y29udGVudA0KDQp4nFXJuw6CMBQA0F+yCSYwONxSrDylFS4to6CXmA4aEqn9ehM3z3pyipTcRjS7pz5L+5FqrYxvZs3iMIVIc6yfwvcF33Ylz6JXSmvVyJ5JPt9LIgHLmnGai2rZGsGt/R24/6P8mgF5G1QNxzgaHzmkPB6AL50JTWgdTj1LbsgQjdCdcagQvSlVjCm6ccAk7Y6IPa1noYt36/yIuK8vDKehy5MT2BKItbBABXA4fAH8+0TP';
    const bytes = Uint8Array.from(Buffer.from(newlyricFixture, 'base64'));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        return {
          ok: true,
          status: 200,
          body: bytes,
        } as unknown as Response;
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          code: 301,
          msg: '音乐查询失败',
          data: { lrclist: [] },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kw', {
      source: 'kw',
      name: 'Fallback Song',
      singer: 'Fallback Artist',
      album: 'Fallback Album',
      duration: 200,
      musicId: '6905536',
    });

    expect(result.lyric).toContain('[00:00.000]Fallback');
    expect(result.lxlyric).toContain('[00:00.000]');
  });

  it('downloads Kugou lrc lyrics after lyric search', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('lyrics.kugou.com/search')) {
        return jsonResponse({
          candidates: [{ id: 12, accesskey: 'token-1' }],
        });
      }
      if (url.includes('lyrics.kugou.com/download')) {
        expect(url).toContain('fmt=lrc');
        return jsonResponse({
          fmt: 'lrc',
          content: Buffer.from('[00:00.00]风起天阑').toString('base64'),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kg', {
      source: 'kg',
      name: '风起天阑',
      singer: '河图',
      album: '风起天阑',
      duration: 301,
      hash: 'kg-hash-1',
    });

    expect(result).toMatchObject({
      lyric: '[00:00.00]风起天阑',
    });
  });

  it('decodes Kugou krc lyrics like lxserver', async () => {
    const krcFixture = 'AAAAADjb6rkSgyYOmpoZBOOY44zKcbFGagJEz+QH4Rz74r5Y8DQqu5eDdXZw6pXpKr7AARNEYu9kCieAkRgJGPftQWxAw8Fiew==';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('lyrics.kugou.com/search')) {
        return jsonResponse({
          candidates: [{ id: 12, accesskey: 'token-1', krctype: 1, contenttype: 0 }],
        });
      }
      if (url.includes('lyrics.kugou.com/download')) {
        expect(url).toContain('fmt=krc');
        return jsonResponse({
          fmt: 'krc',
          content: krcFixture,
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('kg', {
      source: 'kg',
      name: 'Fallback',
      singer: 'Artist',
      album: 'Album',
      duration: 200,
      hash: 'kg-hash-1',
    });

    expect(result.lyric).toContain('[00:00.0]Fallback');
    expect(result.lxlyric).toContain('[00:00.0]<0,500>Fall<500,500>back');
  });

  it('decodes Kuwo newlyric responses when the plugin runtime lacks typed-array slice', async () => {
    const originalSlice = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'slice');
    Object.defineProperty(Uint8Array.prototype, 'slice', {
      configurable: true,
      value: undefined,
    });
    const newlyricFixture = 'dHA9Y29udGVudA0KDQp4nFXJuw6CMBQA0F+yCSYwONxSrDylFS4to6CXmA4aEqn9ehM3z3pyipTcRjS7pz5L+5FqrYxvZs3iMIVIc6yfwvcF33Ylz6JXSmvVyJ5JPt9LIgHLmnGai2rZGsGt/R24/6P8mgF5G1QNxzgaHzmkPB6AL50JTWgdTj1LbsgQjdCdcagQvSlVjCm6ccAk7Y6IPa1noYt36/yIuK8vDKehy5MT2BKItbBABXA4fAH8+0TP';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('newlyric.kuwo.cn/newlyric.lrc')) {
        const bytes = Uint8Array.from(Buffer.from(newlyricFixture, 'base64'));
        return new Response(bytes.buffer, { status: 200 });
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return jsonResponse({
          code: 301,
          msg: '音乐查询失败',
          data: { lrclist: [] },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await resolveMusicLyric('kw', {
        source: 'kw',
        name: 'Fallback Song',
        singer: 'Fallback Artist',
        album: 'Fallback Album',
        duration: 200,
        musicId: '6905536',
      });

      expect(result.lyric).toContain('[00:00.000]Fallback');
      expect(result.lxlyric).toContain('[00:00.000]');
    } finally {
      if (originalSlice) {
        Object.defineProperty(Uint8Array.prototype, 'slice', originalSlice);
      } else {
        delete (Uint8Array.prototype as Partial<Uint8Array>).slice;
      }
    }
  });

  it('loads Migu lyric urls from song info and returns both lyric tracks', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('resourceinfo.do')) {
        return jsonResponse({
          resource: [{
            songId: 'mg-song-1',
            songName: '风起天阑',
            album: '风起天阑',
            copyrightId: 'mg-copy-1',
            length: '05:01',
            artists: [{ name: '河图' }],
            lrcUrl: 'https://lyric.migu.test/1.lrc',
            trcUrl: 'https://lyric.migu.test/1.trc',
          }],
        });
      }
      if (url === 'https://lyric.migu.test/1.lrc') {
        return new Response('[00:00.00]风起天阑', { status: 200 });
      }
      if (url === 'https://lyric.migu.test/1.trc') {
        return new Response('[00:00.00]Wind rises', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMusicLyric('mg', {
      source: 'mg',
      name: '风起天阑',
      singer: '河图',
      album: '风起天阑',
      duration: 301,
      copyrightId: 'mg-copy-1',
    });

    expect(result).toMatchObject({
      lyric: '[00:00.00]风起天阑',
      tlyric: '[00:00.00]Wind rises',
    });
  });
});
