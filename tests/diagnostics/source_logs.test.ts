import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { createRouter } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerDiagnosticsHandlers } from '../../src/handlers/diagnostics';
import { sourceDiagnostics } from '../../src/diagnostics/source_logs';

function parseResponseBody(response: HTTPResponse): any {
  return JSON.parse(String(response.body || 'null'));
}

function request(method: string, path: string, query = ''): HTTPRequest {
  return {
    method,
    path,
    query,
    headers: {},
    body: null,
  } as HTTPRequest;
}

describe('source diagnostics logs', () => {
  beforeEach(() => {
    sourceDiagnostics.clear();
  });

  it('stores recent source attempts and clears them through the diagnostics API', async () => {
    sourceDiagnostics.record({
      operation: 'playback',
      stage: 'resolve',
      status: 'failed',
      sourceId: 'music-downloader',
      sourceName: '音乐下载器 v6',
      platform: 'kw',
      quality: '320k',
      title: 'Song',
      artist: 'Singer',
      durationMs: 23,
      message: '未返回 URL',
    });

    const router = createRouter();
    registerDiagnosticsHandlers(router);

    const list = await router.handle(request('GET', '/api/diagnostics/source-logs'));
    expect(parseResponseBody(list).data).toEqual({
      logs: [
        expect.objectContaining({
          operation: 'playback',
          status: 'failed',
          sourceName: '音乐下载器 v6',
          platform: 'kw',
          quality: '320k',
          message: '未返回 URL',
        }),
      ],
      total: 1,
    });

    const filtered = await router.handle(request('GET', '/api/diagnostics/source-logs', 'operation=download'));
    expect(parseResponseBody(filtered).data).toEqual({ logs: [], total: 0 });

    const cleared = await router.handle(request('POST', '/api/diagnostics/source-logs/clear'));
    expect(parseResponseBody(cleared).data).toEqual({ ok: true });
    expect(sourceDiagnostics.list()).toEqual([]);
  });
});
