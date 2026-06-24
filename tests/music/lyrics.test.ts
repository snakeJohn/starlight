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
