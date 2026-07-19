import { describe, expect, it, beforeEach } from 'vitest';
import type { HTTPRequest } from '@songloft/plugin-sdk';
import {
  handleLxProtocolHttp,
  peerKeyFromRequest,
  resetAuthRateLimitForTests,
} from '../../src/lx_sync/protocol_http';
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

  it('honors x-starlight-trust-proxy header for host adapters', () => {
    const key = peerKeyFromRequest(req({
      remoteAddress: '10.0.0.5',
      headers: {
        'x-starlight-trust-proxy': '1',
        'x-real-ip': '9.9.9.9',
      },
    }));
    expect(key).toBe('9.9.9.9');
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
});

describe('generatePassword', () => {
  it('produces high-entropy secrets longer than six digits', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toMatch(/^\d{6}$/);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
