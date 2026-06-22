import type { HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

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

describe('custom playlist route registration', () => {
  it('registers custom playlist routes during plugin init', async () => {
    vi.resetModules();
    await import('../../src/main');
    await mainGlobals().onInit();

    const response = await mainGlobals().onHTTPRequest({
      method: 'GET',
      path: '/api/custom-playlists',
      query: '',
      headers: {},
      body: null,
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: [],
      error: null,
    });
  });
});
