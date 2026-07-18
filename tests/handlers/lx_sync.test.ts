import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest } from '@songloft/plugin-sdk';
import { registerLxSyncHandlers } from '../../src/handlers/lx_sync';
import { LxSyncService } from '../../src/lx_sync/service';
import {
  handleLxProtocolHttp,
  resetAuthRateLimitForTests,
} from '../../src/lx_sync/protocol_http';
import { SYNC_CODE } from '../../src/lx_sync/constants';
import { aesDecrypt, aesEncrypt, authCodeToAesKey } from '../../src/lx_sync/crypto_lx';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  constants,
} from 'node:crypto';

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers,
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

describe('lx-sync handlers (server mode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('declares websocket + publicPaths so host allows LX /socket upgrade without JWT', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'plugin.json'), 'utf8')) as {
      permissions?: string[];
      publicPaths?: string[];
    };
    // Host rejects WS with: {"detail":"requires 'websocket' permission","error":"permission denied"}
    expect(manifest.permissions).toContain('websocket');
    expect(manifest.publicPaths).toEqual(expect.arrayContaining(['/hello', '/id', '/ah', '/socket']));
  });

  it('exposes server address and password; rejects legacy fields', async () => {
    const service = new LxSyncService({ hostBaseUrl: 'http://192.168.1.10:18191' });
    const router = createRouter();
    registerLxSyncHandlers(router, service);

    const getRes = await router.handle(request('GET', '/api/lx-sync/config'));
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(String(getRes.body));
    expect(getBody.data.serverAddress).toContain('/api/v1/jsplugin/starlight');
    expect(getBody.data.password).toBeTruthy();
    expect(getBody.data).not.toHaveProperty('baseUrl');
    expect(getBody.data).not.toHaveProperty('conflict');

    const rejectCreds = await router.handle(
      request('PUT', '/api/lx-sync/config', { baseUrl: 'http://x', username: 'u' }),
    );
    expect(rejectCreds.statusCode).toBe(400);

    const rejectJsonOpts = await router.handle(
      request('PUT', '/api/lx-sync/config', { conflict: 'merge', importDefaultList: false }),
    );
    expect(rejectJsonOpts.statusCode).toBe(400);

    const putRes = await router.handle(
      request('PUT', '/api/lx-sync/config', {
        password: '654321',
        serverName: 'MyStarlight',
      }),
    );
    expect(putRes.statusCode).toBe(200);
    const putBody = JSON.parse(String(putRes.body)).data;
    expect(putBody.password).toBe('654321');
    expect(putBody.serverName).toBe('MyStarlight');
  });

  it('serves hello / id protocol endpoints', async () => {
    const service = new LxSyncService({ hostBaseUrl: 'http://127.0.0.1:18191' });
    const hello = await handleLxProtocolHttp(request('GET', '/hello'), service);
    expect(hello?.statusCode).toBe(200);
    expect(hello?.body).toBe(SYNC_CODE.helloMsg);

    const idRes = await handleLxProtocolHttp(request('GET', '/id'), service);
    expect(idRes?.statusCode).toBe(200);
    expect(String(idRes?.body)).toMatch(new RegExp(`^${SYNC_CODE.idPrefix}`));
  });

  it('authenticates first-time client with password AES + RSA-OAEP', async () => {
    const service = new LxSyncService();
    await service.updateConfig({ password: '123456' });

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const pubBody = String(publicKey)
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');

    const key = authCodeToAesKey('123456');
    const m = aesEncrypt(`${SYNC_CODE.authMsg}\n${pubBody}\nTestPC\nlx_music_desktop`, key);

    const ah = await handleLxProtocolHttp(request('GET', '/ah', undefined, { m }), service);
    expect(ah?.statusCode).toBe(200);
    const cipher = Buffer.from(String(ah?.body), 'base64');
    const plain = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING },
      cipher,
    ).toString();
    const info = JSON.parse(plain) as { clientId: string; key: string; serverName: string };
    expect(info.clientId).toBeTruthy();
    expect(info.key).toBeTruthy();

    // Returning client keyAuth
    const m2 = aesEncrypt(SYNC_CODE.authMsg + 'TestPC', info.key);
    const ah2 = await handleLxProtocolHttp(
      request('GET', '/ah', undefined, { m: m2, i: info.clientId }),
      service,
    );
    expect(ah2?.statusCode).toBe(200);
    // hello encrypted with session key
    expect(String(ah2?.body).length).toBeGreaterThan(8);
  });

  it('import-to-songloft requires playlist ids', async () => {
    const service = new LxSyncService({
      customPlaylists: {
        syncToSongloftPlaylist: vi.fn(async () => ({
          playlist: { id: 'x', name: 'x', cover_url: '', imported_at: '', updated_at: '', songs: [] },
          total: 0,
          skipped: 0,
          errors: [],
        })),
      },
    });
    const router = createRouter();
    registerLxSyncHandlers(router, service);
    const bad = await router.handle(request('POST', '/api/lx-sync/import-to-songloft', {}));
    expect(bad.statusCode).toBe(400);
  });
});

describe('lx crypto', () => {
  it('AES roundtrip matches password key derivation', () => {
    const key = authCodeToAesKey('123456');
    // Same derivation as Node Buffer.from(md5.slice(0,16)).toString('base64')
    const md5 = createHash('md5').update('123456').digest('hex').substring(0, 16);
    expect(key).toBe(Buffer.from(md5, 'utf8').toString('base64'));
    const enc = aesEncrypt('lx-music auth::hello', key);
    // decrypt via our impl is tested indirectly in auth test
    expect(enc.length).toBeGreaterThan(0);
  });

  it('AES-128-ECB interops with Node createCipheriv/createDecipheriv', () => {
    const key = authCodeToAesKey('654321');
    const keyBuf = Buffer.from(key, 'base64');
    const plain = 'lx-music auth::interop-check';

    // Node encrypt → our decrypt
    const cipher = createCipheriv('aes-128-ecb', keyBuf, null);
    cipher.setAutoPadding(true);
    const nodeEnc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
    expect(aesDecrypt(nodeEnc, key)).toBe(plain);

    // Our encrypt → Node decrypt
    const ourEnc = aesEncrypt(plain, key);
    const decipher = createDecipheriv('aes-128-ecb', keyBuf, null);
    decipher.setAutoPadding(true);
    const nodeDec = Buffer.concat([
      decipher.update(Buffer.from(ourEnc, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    expect(nodeDec).toBe(plain);
  });
});

describe('lx /ah rate limit', () => {
  beforeEach(() => {
    resetAuthRateLimitForTests();
  });

  it('blocks peer after repeated auth failures', async () => {
    const service = new LxSyncService();
    await service.updateConfig({ password: '111111' });
    const peerHeaders = { 'x-forwarded-for': '10.0.0.99', m: 'not-valid-base64!!!' };

    for (let i = 0; i < 8; i++) {
      const res = await handleLxProtocolHttp(
        request('GET', '/ah', undefined, peerHeaders),
        service,
      );
      expect(res?.statusCode).toBe(401);
    }

    const blocked = await handleLxProtocolHttp(
      request('GET', '/ah', undefined, peerHeaders),
      service,
    );
    expect(blocked?.statusCode).toBe(403);
    expect(blocked?.body).toBe(SYNC_CODE.msgBlockedIp);
  });
});


