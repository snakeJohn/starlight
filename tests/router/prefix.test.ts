import { describe, expect, test } from 'vitest';
import { createRouter, jsonResponse } from '@songloft/plugin-sdk';
import type { HTTPResponse } from '@songloft/plugin-sdk';
import { prefixRouter } from '../../src/router/prefix';

function parseResponseBody(response: HTTPResponse): unknown {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

describe('prefixRouter', () => {
  test('registers routes under a prefix without changing handlers', async () => {
    const router = createRouter();
    const miot = prefixRouter(router, '/api/miot');

    miot.get('/auth/status', () => jsonResponse({ success: true }));

    const response = await router.handle({
      method: 'GET',
      path: '/api/miot/auth/status',
      query: '',
      headers: {},
    } as any);

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({ success: true });
  });

  test('joins trailing slash prefixes and paths without leading slashes', async () => {
    const router = createRouter();
    const miot = prefixRouter(router, '/api/miot/');

    miot.get('auth/status', () => jsonResponse({ success: true }));

    const response = await router.handle({
      method: 'GET',
      path: '/api/miot/auth/status',
      query: '',
      headers: {},
    } as any);

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({ success: true });
  });
});
