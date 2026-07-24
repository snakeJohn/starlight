import { afterEach, describe, expect, it, vi } from 'vitest';

describe('authenticateSongloftResourceUrl', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function loadAuth() {
    return await import('../../static/js/auth.js') as {
      authenticateSongloftResourceUrl: (value: string) => string;
      getAuthToken: () => string;
    };
  }

  it('appends token only to same-origin Songloft cover paths', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://192.168.1.10:58091' },
      SongloftPlugin: { getAuthToken: () => 'secret-token' },
    });
    const { authenticateSongloftResourceUrl } = await loadAuth();

    expect(authenticateSongloftResourceUrl('/api/v1/songs/42/cover')).toBe(
      '/api/v1/songs/42/cover?access_token=secret-token',
    );
    expect(
      authenticateSongloftResourceUrl('http://192.168.1.10:58091/api/v1/songs/42/cover'),
    ).toBe('http://192.168.1.10:58091/api/v1/songs/42/cover?access_token=secret-token');
  });

  it('never attaches token to foreign origins that merely match the cover path', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://192.168.1.10:58091' },
      SongloftPlugin: { getAuthToken: () => 'secret-token' },
    });
    const { authenticateSongloftResourceUrl } = await loadAuth();

    const evil = 'https://evil.example/api/v1/songs/x/cover';
    expect(authenticateSongloftResourceUrl(evil)).toBe(evil);
    expect(authenticateSongloftResourceUrl(evil)).not.toContain('access_token');
  });

  it('leaves external CDN covers untouched', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:58091' },
      SongloftPlugin: { getAuthToken: () => 'secret-token' },
    });
    const { authenticateSongloftResourceUrl } = await loadAuth();

    const cdn = 'https://p2.music.126.net/abc/cover.jpg';
    expect(authenticateSongloftResourceUrl(cdn)).toBe(cdn);
  });
});
