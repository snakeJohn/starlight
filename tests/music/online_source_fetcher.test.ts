import { describe, expect, test, vi } from 'vitest';
import {
  OnlineSourceFetcher,
  forceOnlineSourceDnsUnavailableForTests,
  normalizeOnlineSourceUrl,
  redactOnlineSourceUrl,
  resetOnlineSourceDnsCacheForTests,
} from '../../src/music/online_source_fetcher';
import { StarlightError } from '../../src/system/errors';

const validSourceScript = String.raw`/*!
 * @name Online Source
 * @version 1.0.0
 * @author Test
 */
lx.send('inited', { status: true });
`;

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

function response(
  status: number,
  body: string,
  headerInit: Record<string, string> = {},
  options: { stream?: boolean } = {},
): Response {
  const hdrs = headers(headerInit);
  if (options.stream) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream, { status, headers: hdrs });
  }
  return new Response(body, { status, headers: hdrs });
}

function fetcher(overrides: {
  fetchImpl?: typeof fetch;
  resolvePublicHost?: (hostname: string) => Promise<boolean>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
} = {}): OnlineSourceFetcher {
  return new OnlineSourceFetcher({
    fetchImpl: overrides.fetchImpl ?? (vi.fn() as unknown as typeof fetch),
    resolvePublicHost: overrides.resolvePublicHost ?? (async () => true),
    timeoutMs: overrides.timeoutMs,
    maxBytes: overrides.maxBytes,
    maxRedirects: overrides.maxRedirects,
  });
}

describe('normalizeOnlineSourceUrl', () => {
  test('normalizes fragment and default https port but keeps query identity', () => {
    expect(normalizeOnlineSourceUrl('HTTPS://Example.test:443/a.js?token=x#part')).toEqual({
      sourceUrl: 'https://example.test/a.js?token=x',
      pathname: '/a.js',
    });
  });

  test('rejects non-https, credentials, and non-js pathname', () => {
    expect(() => normalizeOnlineSourceUrl('http://example.test/a.js')).toThrow(
      expect.objectContaining({ code: 'SOURCE_ONLINE_URL_INVALID' }),
    );
    expect(() => normalizeOnlineSourceUrl('https://user:pass@example.test/a.js')).toThrow(
      expect.objectContaining({ code: 'SOURCE_ONLINE_URL_INVALID' }),
    );
    expect(() => normalizeOnlineSourceUrl('https://example.test/a.txt')).toThrow(
      expect.objectContaining({ code: 'SOURCE_ONLINE_URL_INVALID' }),
    );
  });
});

describe('redactOnlineSourceUrl', () => {
  test('redacts sensitive query values', () => {
    const redacted = redactOnlineSourceUrl('https://example.test/a.js?token=secret&key=abc&name=ok');
    expect(redacted).toContain('token=***');
    expect(redacted).toContain('key=***');
    expect(redacted).toContain('name=ok');
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('abc');
  });
});

describe('OnlineSourceFetcher', () => {
  test('revalidates every redirect and reads at most 2 MiB', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(302, '', { location: 'https://cdn.test/source.js' }))
      .mockResolvedValueOnce(
        response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
      );

    const result = await fetcher({ fetchImpl }).fetch('https://origin.test/source.js');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sourceUrl).toBe('https://origin.test/source.js');
    expect(result.resolvedUrl).toBe('https://cdn.test/source.js');
    expect(result.filename).toBe('source.js');
    expect(result.content).toContain('lx.send');
    expect(result.contentHash).toEqual(expect.any(String));
    expect(result.contentHash.length).toBeGreaterThan(0);
  });

  test.each([
    'http://origin.test/source.js',
    'https://origin.test/source.txt',
    'https://127.0.0.1/source.js',
  ])('rejects unsafe URL %s', async (url) => {
    const instance = fetcher({
      resolvePublicHost: async (hostname) => !['127.0.0.1', 'localhost'].includes(hostname),
    });
    await expect(instance.fetch(url)).rejects.toMatchObject({ code: 'SOURCE_ONLINE_URL_INVALID' });
  });

  test('rejects private host after DNS resolution failure-closed', async () => {
    const fetchImpl = vi.fn();
    const instance = fetcher({
      fetchImpl,
      resolvePublicHost: async () => false,
    });
    await expect(instance.fetch('https://evil.internal/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_URL_INVALID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects unsafe redirect targets before following them', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(302, '', { location: 'http://cdn.test/source.js' }));
    const instance = fetcher({ fetchImpl });
    await expect(instance.fetch('https://origin.test/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_REDIRECT_INVALID',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('rejects more than 3 redirects', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(302, '', { location: 'https://a.test/source.js' }))
      .mockResolvedValueOnce(response(302, '', { location: 'https://b.test/source.js' }))
      .mockResolvedValueOnce(response(302, '', { location: 'https://c.test/source.js' }))
      .mockResolvedValueOnce(response(302, '', { location: 'https://d.test/source.js' }));
    await expect(fetcher({ fetchImpl }).fetch('https://origin.test/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_REDIRECT_INVALID',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test('rejects responses larger than maxBytes via content-length', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(200, validSourceScript, {
        'content-type': 'application/javascript',
        'content-length': String(3 * 1024 * 1024),
      }),
    );
    await expect(fetcher({ fetchImpl }).fetch('https://origin.test/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_TOO_LARGE',
    });
  });

  test('rejects oversize streamed bodies', async () => {
    const maxBytes = 64;
    const bigBody = `${validSourceScript}\n${'x'.repeat(200)}`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(bigBody);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 40));
        controller.enqueue(bytes.subarray(40));
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      }),
    );
    await expect(fetcher({ fetchImpl, maxBytes }).fetch('https://origin.test/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_TOO_LARGE',
    });
  });

  test('rejects HTML and empty content without including body in the error', async () => {
    const html = '<!doctype html><html><body>not a source</body></html>';
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(200, html, { 'content-type': 'text/html' }, { stream: true }),
    );
    try {
      await fetcher({ fetchImpl }).fetch('https://origin.test/source.js');
      expect.fail('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(StarlightError);
      expect((error as StarlightError).code).toBe('SOURCE_ONLINE_CONTENT_INVALID');
      expect(String((error as Error).message)).not.toContain('<!doctype');
      expect(JSON.stringify((error as StarlightError).details)).not.toContain('<!doctype');
    }
  });

  test('rejects scripts without lx.send feature marker', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(200, 'const x = 1;', { 'content-type': 'application/javascript' }, { stream: true }),
    );
    await expect(fetcher({ fetchImpl }).fetch('https://origin.test/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_CONTENT_INVALID',
    });
  });

  test('maps timeout errors without leaking secrets from the URL', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => {
      const { FetchTimeoutError } = await import('../../src/utils/fetch_timeout');
      throw new FetchTimeoutError('Request timed out after 15000ms');
    });
    try {
      await fetcher({ fetchImpl }).fetch('https://origin.test/source.js?token=supersecret');
      expect.fail('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'SOURCE_ONLINE_TIMEOUT' });
      expect(String((error as Error).message)).not.toContain('supersecret');
      expect(JSON.stringify((error as StarlightError).details)).not.toContain('supersecret');
    }
  });

  test('accepts missing content-type when body is a valid source script', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, validSourceScript, {}, { stream: true }));
    const result = await fetcher({ fetchImpl }).fetch('https://origin.test/source.js');
    expect(result.content).toContain('lx.send');
  });

  test('enforces total deadline while reading a slow response body', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Never enqueues; body stays open so reader.read() would hang without a deadline.
        void controller;
      },
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      }),
    );

    await expect(
      fetcher({ fetchImpl, timeoutMs: 40 }).fetch('https://origin.test/source.js?token=supersecret'),
    ).rejects.toMatchObject({ code: 'SOURCE_ONLINE_TIMEOUT' });
  });

  test('default DNS resolver accepts public hostname when all resolved addresses are public', async () => {
    resetOnlineSourceDnsCacheForTests();
    const g = globalThis as { dns?: unknown };
    const previous = g.dns;
    g.dns = {
      promises: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      },
    };
    try {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
      );
      // No resolvePublicHost override — exercises defaultResolvePublicHost + DNS helper.
      const instance = new OnlineSourceFetcher({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5_000,
      });
      const result = await instance.fetch('https://example.com/source.js');
      expect(result.content).toContain('lx.send');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete g.dns;
      else g.dns = previous;
      resetOnlineSourceDnsCacheForTests();
    }
  });

  test('default DNS resolver rejects hostname that resolves only to private addresses', async () => {
    resetOnlineSourceDnsCacheForTests();
    const g = globalThis as { dns?: unknown };
    const previous = g.dns;
    g.dns = {
      promises: {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      },
    };
    try {
      const fetchImpl = vi.fn();
      const instance = new OnlineSourceFetcher({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await expect(instance.fetch('https://evil.internal/source.js')).rejects.toMatchObject({
        code: 'SOURCE_ONLINE_URL_INVALID',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete g.dns;
      else g.dns = previous;
      resetOnlineSourceDnsCacheForTests();
    }
  });

  test('without a connection-safe fetch capability rejects hostnames without calling ordinary fetch', async () => {
    forceOnlineSourceDnsUnavailableForTests();
    try {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
      );
      const instance = new OnlineSourceFetcher({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5_000,
      });
      await expect(instance.fetch('https://cdn.example.com/source.js')).rejects.toMatchObject({
        code: 'SOURCE_ONLINE_URL_INVALID',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      resetOnlineSourceDnsCacheForTests();
    }
  });

  test('blocks a hostname that rebinds from a public preflight address to a private connection address', async () => {
    const ordinaryFetch = vi.fn().mockResolvedValueOnce(
      response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
    );
    const connectionSafeFetch = vi.fn(async (
      _url: string,
      _init: RequestInit,
      assertConnectionAddress: (address: string) => void,
    ) => {
      assertConnectionAddress('127.0.0.1');
      return response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true });
    });
    const options = {
      fetchImpl: ordinaryFetch as unknown as typeof fetch,
      resolvePublicHost: async () => true,
      connectionSafeFetch,
    };
    const instance = new OnlineSourceFetcher(options);

    await expect(instance.fetch('https://rebind.example/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_URL_INVALID',
    });
    expect(connectionSafeFetch).toHaveBeenCalledTimes(1);
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  test('blocks private IPv4-mapped IPv6 among multiple connection candidates', async () => {
    const ordinaryFetch = vi.fn().mockResolvedValueOnce(
      response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
    );
    const connectionSafeFetch = vi.fn(async (
      _url: string,
      _init: RequestInit,
      assertConnectionAddress: (address: string) => void,
    ) => {
      assertConnectionAddress('93.184.216.34');
      assertConnectionAddress('::ffff:169.254.169.254');
      return response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true });
    });
    const options = {
      fetchImpl: ordinaryFetch as unknown as typeof fetch,
      resolvePublicHost: async () => true,
      connectionSafeFetch,
    };

    await expect(new OnlineSourceFetcher(options).fetch('https://multi.example/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_URL_INVALID',
    });
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  test('applies the connection address guard to every redirect target', async () => {
    const ordinaryFetch = vi
      .fn()
      .mockResolvedValueOnce(response(302, '', { location: 'https://redirect.example/source.js' }))
      .mockResolvedValueOnce(
        response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true }),
      );
    let actualConnections = 0;
    const connectionSafeFetch = vi.fn(async (
      _url: string,
      _init: RequestInit,
      assertConnectionAddress: (address: string) => void,
    ) => {
      if (actualConnections === 0) {
        assertConnectionAddress('93.184.216.34');
        actualConnections += 1;
        return response(302, '', { location: 'https://redirect.example/source.js' });
      }
      assertConnectionAddress('10.0.0.5');
      actualConnections += 1;
      return response(200, validSourceScript, { 'content-type': 'application/javascript' }, { stream: true });
    });
    const options = {
      fetchImpl: ordinaryFetch as unknown as typeof fetch,
      resolvePublicHost: async () => true,
      connectionSafeFetch,
    };

    await expect(new OnlineSourceFetcher(options).fetch('https://origin.example/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_REDIRECT_INVALID',
    });
    expect(actualConnections).toBe(1);
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  test('assertPublicHost DNS hang is bounded by absolute timeout', async () => {
    const fetchImpl = vi.fn();
    const instance = new OnlineSourceFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 40,
      resolvePublicHost: () => new Promise(() => {
        /* never resolves */
      }),
    });
    await expect(instance.fetch('https://hang.example/source.js')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_TIMEOUT',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
