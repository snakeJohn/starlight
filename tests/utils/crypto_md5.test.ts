import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `md5()` falls back to a hand-rolled pure-JS MD5 whenever the host provides no
 * `crypto.md5` polyfill (vitest, and any plugin runtime without one). Kugou
 * request signing depends on it, so a wrong digest silently breaks that source.
 */
describe('md5 pure-JS fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadMd5(): Promise<(value: string) => string> {
    vi.stubGlobal('crypto', {});
    vi.resetModules();
    return (await import('../../src/utils/crypto')).md5;
  }

  it('matches the RFC 1321 test suite', async () => {
    const md5 = await loadMd5();

    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))
      .toBe('d174ab98d277d9f5a5611c2c9f419d9f');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('handles the 56-byte padding boundary', async () => {
    const md5 = await loadMd5();

    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });

  it('UTF-8 encodes CJK and surrogate pairs the same way Node does', async () => {
    const md5 = await loadMd5();

    expect(md5('中文')).toBe('a7bac2239fcdcb3a067903d8077c4a07');
    // U+1F3B5 MUSICAL NOTE — exercises the 4-byte surrogate-pair branch.
    expect(md5('🎵')).toBe('571a5ba7aec0b965e1f2f6e272a279fa');
  });

  it('prefers the host polyfill when one is available', async () => {
    const polyfillMd5 = vi.fn(() => 'digest-from-host');
    vi.stubGlobal('crypto', { md5: polyfillMd5 });
    vi.resetModules();
    const { md5 } = await import('../../src/utils/crypto');

    expect(md5('abc')).toBe('digest-from-host');
    expect(polyfillMd5).toHaveBeenCalledWith('abc');
  });
});
