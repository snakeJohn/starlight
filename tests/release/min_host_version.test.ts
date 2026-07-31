import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Starlight serves the 洛雪 sync protocol over an inbound plugin WebSocket
 * (`/socket` → globalThis.onWebSocket). The Songloft host only dispatches
 * WebSocket upgrades to plugins from v2.9.5 onward; older hosts forward the
 * upgrade to onHTTPRequest, so the LX client fails with
 * "Expect HTTP 101 response but was '404 Not Found'".
 *
 * minHostVersion must therefore stay at or above 2.9.5.
 */
const MIN_WEBSOCKET_HOST_VERSION = [2, 9, 5] as const;

function parseVersion(value: string): number[] {
  return value.split('.').map((part) => Number.parseInt(part, 10));
}

function isAtLeast(actual: number[], required: readonly number[]): boolean {
  for (let i = 0; i < required.length; i++) {
    const a = actual[i] ?? 0;
    const r = required[i];
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}

describe('plugin manifest host requirements', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'plugin.json'), 'utf8'),
  ) as { minHostVersion?: string; permissions?: string[]; publicPaths?: string[] };

  it('requires a host version that routes plugin WebSocket upgrades', () => {
    expect(manifest.minHostVersion).toBeTruthy();
    const actual = parseVersion(String(manifest.minHostVersion));
    expect(actual.every((n) => Number.isFinite(n))).toBe(true);
    expect(isAtLeast(actual, MIN_WEBSOCKET_HOST_VERSION)).toBe(true);
  });

  it('declares the websocket permission the /socket handler needs', () => {
    expect(manifest.permissions || []).toContain('websocket');
  });

  it('exposes the LX protocol paths without JWT', () => {
    expect(manifest.publicPaths || []).toEqual(
      expect.arrayContaining(['/hello', '/id', '/ah', '/socket']),
    );
  });
});
