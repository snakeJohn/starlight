import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { HTTPRequest } from '@songloft/plugin-sdk';
import {
  handleLxProtocolHttp,
  peerKeyFromRequest,
  resetAuthRateLimitForTests,
} from '../../src/lx_sync/protocol_http';
import {
  AUTH_BLOCK_MS,
  AUTH_MAX_FAILURES,
  getAuthPeerCount,
  isPeerBlocked,
  recordAuthFailure,
} from '../../src/lx_sync/auth_rate_limit';
import { generatePassword } from '../../src/lx_sync/crypto_lx';
import type { LxSyncService } from '../../src/lx_sync/service';

function req(partial: Partial<HTTPRequest> & Record<string, unknown> = {}): HTTPRequest {
  return {
    method: 'GET',
    path: '/ah',
    query: '',
    headers: {},
    body: null,
    ...partial,
  } as HTTPRequest;
}

describe('peerKeyFromRequest', () => {
  it('uses transport peer and ignores spoofed X-Forwarded-For by default', () => {
    const key = peerKeyFromRequest(req({
      remoteAddress: '10.0.0.5',
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '5.6.7.8',
      },
    }));
    expect(key).toBe('10.0.0.5');
  });

  it('honors forwarded headers only when trusted proxy is declared', () => {
    const key = peerKeyFromRequest(req({
      remoteAddress: '10.0.0.5',
      trustedProxy: true,
      headers: {
        'x-forwarded-for': '1.2.3.4, 10.0.0.5',
      },
    }));
    expect(key).toBe('1.2.3.4');
  });

  it('ignores client-supplied x-starlight-trust-proxy header', () => {
    const key = peerKeyFromRequest(req({
      remoteAddress: '10.0.0.5',
      headers: {
        'x-starlight-trust-proxy': '1',
        'x-real-ip': '9.9.9.9',
        'x-forwarded-for': '1.2.3.4',
      },
    }));
    expect(key).toBe('10.0.0.5');
  });
});

describe('LX /ah rate limit bypass protection', () => {
  beforeEach(() => {
    resetAuthRateLimitForTests();
  });

  it('blocks after eight failures from one transport peer despite rotating XFF', async () => {
    const service = {
      async getServerMeta() {
        return { enabled: true, serverId: 'sid', password: 'real-secret' };
      },
      async getAuthPasswordKey() {
        return Buffer.from('0123456789abcdef').toString('base64');
      },
      async getDevice() {
        return null;
      },
    } as unknown as LxSyncService;

    // Drive failures by omitting m (auth header); peer is always transport address.
    for (let i = 0; i < 8; i++) {
      const response = await handleLxProtocolHttp(
        req({
          path: '/ah',
          remoteAddress: '203.0.113.10',
          headers: {
            'x-forwarded-for': `198.51.100.${i}`,
          },
        }),
        service,
      );
      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(401);
    }

    const blocked = await handleLxProtocolHttp(
      req({
        path: '/ah',
        remoteAddress: '203.0.113.10',
        headers: {
          'x-forwarded-for': '198.51.100.99',
        },
      }),
      service,
    );
    expect(blocked!.statusCode).toBe(403);
    expect(String(blocked!.body)).toBe('Blocked IP');
  });

  it('blocks after eight failures even when clients rotate trust-proxy + XFF', async () => {
    const service = {
      async getServerMeta() {
        return { enabled: true, serverId: 'sid', password: 'real-secret' };
      },
      async getAuthPasswordKey() {
        return Buffer.from('0123456789abcdef').toString('base64');
      },
      async getDevice() {
        return null;
      },
    } as unknown as LxSyncService;

    for (let i = 0; i < 8; i++) {
      const response = await handleLxProtocolHttp(
        req({
          path: '/ah',
          remoteAddress: '203.0.113.20',
          headers: {
            'x-starlight-trust-proxy': 'true',
            'x-forwarded-for': `198.51.100.${i}`,
          },
        }),
        service,
      );
      expect(response!.statusCode).toBe(401);
    }

    const blocked = await handleLxProtocolHttp(
      req({
        path: '/ah',
        remoteAddress: '203.0.113.20',
        headers: {
          'x-starlight-trust-proxy': '1',
          'x-forwarded-for': '198.51.100.99',
        },
      }),
      service,
    );
    expect(blocked!.statusCode).toBe(403);
  });
});

describe('auth rate-limit bookkeeping', () => {
  beforeEach(() => {
    resetAuthRateLimitForTests();
  });

  it('keeps no state for peers that never failed', () => {
    expect(isPeerBlocked('203.0.113.77')).toBe(false);
    expect(getAuthPeerCount()).toBe(0);
  });

  it('drops peer state once the block has expired', () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < AUTH_MAX_FAILURES; i++) recordAuthFailure('203.0.113.78', now);
    expect(isPeerBlocked('203.0.113.78', now)).toBe(true);
    expect(getAuthPeerCount()).toBe(1);

    expect(isPeerBlocked('203.0.113.78', now + AUTH_BLOCK_MS + 1)).toBe(false);
    expect(getAuthPeerCount()).toBe(0);
  });
});

describe('LX /socket reached over plain HTTP (host without WS dispatch)', () => {
  const service = {} as unknown as LxSyncService;
  let logError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logError = vi.fn();
    (globalThis as { songloft?: unknown }).songloft = {
      log: { info: vi.fn(), warn: vi.fn(), error: logError },
    };
  });

  it('reports an explicit cause instead of falling through to a bare 404', async () => {
    const response = await handleLxProtocolHttp(
      req({
        method: 'GET',
        path: '/api/v1/jsplugin/starlight/socket',
        query: 'i=cid&t=token',
        headers: { upgrade: 'websocket', connection: 'Upgrade' },
      }),
      service,
    );

    expect(response).not.toBeNull();
    expect(response!.statusCode).toBe(501);
    expect(String(response!.body)).toMatch(/2\.9\.5/);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('onWebSocket'));
  });

  it('names the stripped Connection header when a proxy drops it', async () => {
    const response = await handleLxProtocolHttp(
      req({
        path: '/api/v1/jsplugin/starlight/socket',
        // Upgrade survived but hop-by-hop Connection did not.
        headers: { upgrade: 'websocket' },
      }),
      service,
    );

    expect(response!.statusCode).toBe(501);
    expect(String(response!.body)).toMatch(/Connection: Upgrade/);
    expect(String(response!.body)).toMatch(/reverse proxy/i);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('connection=none'));
  });

  it('matches the bare /socket path the host passes with the prefix stripped', async () => {
    const response = await handleLxProtocolHttp(
      req({ path: '/socket', headers: { upgrade: 'websocket', connection: 'upgrade' } }),
      service,
    );
    expect(response!.statusCode).toBe(501);
  });

  it('still answers a non-upgrade probe without claiming a host version problem', async () => {
    const response = await handleLxProtocolHttp(req({ path: '/socket' }), service);
    expect(response!.statusCode).toBe(501);
    expect(String(response!.body)).toMatch(/WebSocket upgrade request/);
  });

  it('does not intercept unrelated paths', async () => {
    const response = await handleLxProtocolHttp(
      req({ path: '/api/lx-sync/config' }),
      service,
    );
    expect(response).toBeNull();
  });
});

describe('generatePassword', () => {  it('produces high-entropy secrets longer than six digits', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toMatch(/^\d{6}$/);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
