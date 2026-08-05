import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithRedirects,
  getHostBaseUrl,
  httpFetch,
  isUsableHostBaseUrl,
  normalizeHostBaseUrl,
  requireHostBaseUrl,
  resolveHostBaseUrl,
  setHostBaseUrl,
} from '../../src/utils/http';
import { CookieJar } from '../../src/utils/cookie';

function songloftPlugin() {
  return (globalThis as unknown as { songloft: { plugin: { getHostUrl: () => Promise<string> } } }).songloft.plugin;
}

describe('host base URL resolution', () => {
  beforeEach(() => {
    setHostBaseUrl('');
    songloftPlugin().getHostUrl = async () => 'http://127.0.0.1:18191';
  });

  afterEach(() => {
    setHostBaseUrl('');
    songloftPlugin().getHostUrl = async () => 'http://127.0.0.1:18191';
    vi.restoreAllMocks();
  });

  it('rejects port 0 and empty hosts', () => {
    expect(isUsableHostBaseUrl('')).toBe(false);
    expect(isUsableHostBaseUrl('http://localhost:0')).toBe(false);
    expect(isUsableHostBaseUrl('http://127.0.0.1:0/api/v1')).toBe(false);
    expect(isUsableHostBaseUrl('http://127.0.0.1:18191')).toBe(true);
    expect(normalizeHostBaseUrl('http://127.0.0.1:18191/api/v1/jsplugin/starlight')).toBe(
      'http://127.0.0.1:18191',
    );
  });

  it('prefers explicit config over invalid SDK localhost:0', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://localhost:0');

    const host = await resolveHostBaseUrl('http://192.168.1.8:18191');
    expect(host).toBe('http://192.168.1.8:18191');
    expect(getHostBaseUrl()).toBe('http://192.168.1.8:18191');
  });

  it('falls back to valid SDK host when config empty', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://127.0.0.1:18191/api/v1/jsplugin/starlight');

    setHostBaseUrl('');
    const host = await resolveHostBaseUrl('');
    expect(host).toBe('http://127.0.0.1:18191');
  });

  it('does not replace valid cache with invalid SDK', async () => {
    const getHostUrl = vi.fn(async () => 'http://localhost:0');
    songloftPlugin().getHostUrl = getHostUrl;
    setHostBaseUrl('http://10.0.0.2:18191');

    const host = await resolveHostBaseUrl('');
    expect(host).toBe('http://10.0.0.2:18191');
    expect(getHostUrl).not.toHaveBeenCalled();
  });

  it('requireHostBaseUrl throws when only invalid SDK is available', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://localhost:0');
    setHostBaseUrl('');

    await expect(requireHostBaseUrl('')).rejects.toThrow(/Songloft 访问地址不可用/);
  });
});

describe('httpFetch response headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a spec-compliant Headers object (own keys are empty on Headers)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 302,
      headers: {
        Location: 'https://account.example.com/next',
        'Set-Cookie': 'sid=abc; Path=/',
      },
    })));

    const response = await httpFetch('https://account.example.com/login');
    expect(response.headers.get('location')).toBe('https://account.example.com/next');
    expect(response.headers.getSetCookie()).toContain('sid=abc; Path=/');
  });

  it('still reads plain-object headers from the QuickJS fetch polyfill', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
      text: async () => '{}',
    })));

    const response = await httpFetch('https://api.example.com/thing');
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('strips sensitive cookies when a redirect crosses origins', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: options.headers || {} });
      if (requests.length === 1) {
        return new Response('', {
          status: 302,
          headers: { Location: 'https://redirect.example.com/next' },
        });
      }
      return new Response('{}', { status: 200 });
    }));

    await fetchWithRedirects(
      'https://api.example.com/conversation',
      { method: 'GET', headers: { Cookie: 'serviceToken=secret; deviceId=device-1; lang=zh' } },
      new CookieJar(),
      2,
    );

    expect(requests[0].headers.Cookie).toContain('serviceToken=secret');
    expect(requests[0].headers.Cookie).toContain('deviceId=device-1');
    expect(requests[1].headers.Cookie).not.toContain('serviceToken=secret');
    expect(requests[1].headers.Cookie).not.toContain('deviceId=device-1');
    expect(requests[1].headers.Cookie).toContain('lang=zh');
  });

  it('keeps explicit cookies for same-origin redirects', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: options.headers || {} });
      if (requests.length === 1) {
        return new Response('', {
          status: 302,
          headers: { Location: '/next' },
        });
      }
      return new Response('{}', { status: 200 });
    }));

    await fetchWithRedirects(
      'https://api.example.com/conversation',
      { method: 'GET', headers: { Cookie: 'serviceToken=secret; deviceId=device-1' } },
      new CookieJar(),
      2,
    );

    expect(requests[1].headers.Cookie).toContain('serviceToken=secret');
    expect(requests[1].headers.Cookie).toContain('deviceId=device-1');
  });
});
