import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, FetchTimeoutError, redactForLog } from '../../src/utils/fetch_timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts via AbortController when the request exceeds timeout', async () => {
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      seenSignal = init?.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }));

    await expect(
      fetchWithTimeout('https://example.invalid/slow', { timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(seenSignal?.aborted).toBe(true);
  });

  it('clears timer on successful response', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const resp = await fetchWithTimeout('https://example.invalid/ok', { timeoutMs: 5000 });
    expect(resp.status).toBe(200);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('redactForLog', () => {
  it('masks bearer tokens and api keys', () => {
    expect(redactForLog('Authorization: Bearer sk-abc def')).toContain('***');
    expect(redactForLog('api_key":"sk-secret-value"')).toContain('***');
  });
});
