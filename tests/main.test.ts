import type { HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, test, vi } from 'vitest';

interface MainGlobals {
  onInit(): Promise<void>;
  onHTTPRequest(req: { method: string; path: string; query: string; headers: Record<string, string>; body?: string | null }): Promise<HTTPResponse>;
}

function mainGlobals(): MainGlobals {
  return globalThis as typeof globalThis & MainGlobals;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }
}

describe('plugin main lifecycle', () => {
  test('registers HTTP routes before enabled music sources finish loading', async () => {
    vi.resetModules();
    await songloft.storage.set('starlight:music:sources', JSON.stringify([
      {
        id: 'slow-source',
        name: 'Slow Source',
        version: '',
        description: '',
        author: '',
        homepage: '',
        filename: 'slow-source.js',
        importedAt: '2026-06-21T00:00:00.000Z',
        enabled: true,
        supportedPlatforms: [],
      },
    ]));
    await songloft.storage.set('starlight:music:source_script:slow-source', "lx.send('inited', { sources: { kw: {} } });");
    const executeWait = vi.fn(async () => new Promise<never>(() => {}));
    songloft.jsenv.executeWait = executeWait as typeof songloft.jsenv.executeWait;

    await import('../src/main');
    const initPromise = mainGlobals().onInit();
    await waitFor(() => executeWait.mock.calls.length > 0);

    const response = await mainGlobals().onHTTPRequest({
      method: 'GET',
      path: '/api/health/summary',
      query: '',
      headers: {},
      body: null,
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: {
        source_count: 1,
        enabled_source_count: 1,
        loaded_runtime_count: 0,
      },
    });
    await expect(Promise.race([
      initPromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 10)),
    ])).resolves.toBe('resolved');
  });
});
