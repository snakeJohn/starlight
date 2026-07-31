import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import {
  clearAuthRateLimits,
  isPeerBlocked,
  recordAuthFailure,
  recordAuthSuccess,
  resetAuthRateLimitForTests,
} from './auth_rate_limit';
import { SYNC_CODE } from './constants';
import { aesDecrypt, aesEncrypt, rsaEncryptJson } from './crypto_lx';
import type { LxSyncService } from './service';

export { clearAuthRateLimits, resetAuthRateLimitForTests };

function textResponse(body: string, statusCode = 200): HTTPResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body,
  };
}

function header(req: HTTPRequest, name: string): string {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return String(headers[key] ?? '');
  }
  return '';
}

/**
 * Client identity for /ah rate limiting.
 * Prefer the transport peer address. Forwarded headers are only honored when
 * the host sets req.trustedProxy = true (host/SDK-injected, never client-writable).
 * Client-supplied headers such as x-starlight-trust-proxy are intentionally ignored
 * so callers cannot rotate X-Forwarded-For to bypass the block.
 */
export function peerKeyFromRequest(req: HTTPRequest): string {
  const anyReq = req as HTTPRequest & {
    remoteAddress?: string;
    ip?: string;
    socket?: { remoteAddress?: string };
    connection?: { remoteAddress?: string };
    trustedProxy?: boolean;
  };
  const transport =
    (typeof anyReq.remoteAddress === 'string' && anyReq.remoteAddress.trim())
    || (typeof anyReq.ip === 'string' && anyReq.ip.trim())
    || (typeof anyReq.socket?.remoteAddress === 'string' && anyReq.socket.remoteAddress.trim())
    || (typeof anyReq.connection?.remoteAddress === 'string' && anyReq.connection.remoteAddress.trim())
    || '';

  // Only host-injected trustedProxy is authoritative. Never trust a client header.
  if (anyReq.trustedProxy === true) {
    const xff = header(req, 'x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = header(req, 'x-real-ip');
    if (realIp) return realIp;
  }

  return transport || 'unknown';
}

/**
 * Handle public LX protocol HTTP routes: /hello /id /ah
 * Returns null if path is not a protocol route.
 */
export async function handleLxProtocolHttp(
  req: HTTPRequest,
  service: LxSyncService,
): Promise<HTTPResponse | null> {
  const path = String(req.path || '').split('?')[0].replace(/\/+$/, '') || '/';
  // Host may pass full plugin-relative paths or with entry prefix stripped.
  const normalized = path.endsWith('/hello')
    ? '/hello'
    : path.endsWith('/id')
      ? '/id'
      : path.endsWith('/ah')
        ? '/ah'
        : path.endsWith('/socket')
          ? '/socket'
          : path;

  if (normalized === '/socket') {
    // Reaching onHTTPRequest at all means the host did not dispatch this upgrade
    // to onWebSocket. Without this branch the SDK router 404s and LX clients only
    // report the opaque "Expect HTTP 101 response but was '404 Not Found'".
    return handleSocketUpgradeFallback(req);
  }

  if (normalized === '/hello') {
    const meta = await service.getServerMeta();
    if (!meta.enabled) return textResponse(SYNC_CODE.msgAuthFailed, 403);
    return textResponse(SYNC_CODE.helloMsg, 200);
  }

  if (normalized === '/id') {
    const meta = await service.getServerMeta();
    if (!meta.enabled) return textResponse(SYNC_CODE.msgAuthFailed, 403);
    return textResponse(SYNC_CODE.idPrefix + meta.serverId, 200);
  }

  if (normalized === '/ah') {
    return handleAuth(req, service);
  }

  return null;
}

/**
 * `/socket` reached the plain HTTP handler instead of onWebSocket.
 *
 * The host dispatches WebSocket upgrades to onWebSocket only when gorilla's
 * `isWebSocketUpgrade` matches (host >= 2.9.5 has that branch at all). Anything
 * else — an older host, or upgrade headers lost in transit — is forwarded to
 * onHTTPRequest, where no `/socket` route exists, so the client sees a bare 404
 * and reports "Expect HTTP 101 response but was '404 Not Found'".
 *
 * Replies 501 with the headers actually received so the cause is visible from the
 * LX client status line and the plugin log, instead of an opaque 404.
 */
function handleSocketUpgradeFallback(req: HTTPRequest): HTTPResponse {
  const upgrade = header(req, 'upgrade').toLowerCase();
  const connection = header(req, 'connection').toLowerCase();
  const isUpgradeAttempt = upgrade === 'websocket';
  // gorilla/websocket requires BOTH headers; `Connection` is hop-by-hop, so a
  // reverse proxy that does not forward it makes the host treat the upgrade as a
  // plain GET and route it here instead of onWebSocket.
  const connectionDropped = isUpgradeAttempt && !connection.includes('upgrade');

  songloft.log.error(
    '[LxSync] /socket reached onHTTPRequest instead of onWebSocket' +
      ` (upgrade=${upgrade || 'none'} connection=${connection || 'none'}).` +
      (connectionDropped
        ? ' The "Connection: Upgrade" header was lost — check the reverse proxy in front of Songloft.'
        : ' Inbound plugin WebSockets need Songloft >= 2.9.5; upgrade the host.'),
  );

  if (connectionDropped) {
    return textResponse(
      'LX sync WebSocket blocked: the "Connection: Upgrade" header did not reach Songloft.'
        + ' A reverse proxy is stripping it — enable WebSocket passthrough for this path.',
      501,
    );
  }

  return textResponse(
    isUpgradeAttempt
      ? 'LX sync WebSocket unavailable: Songloft host does not route plugin WebSocket upgrades (requires host >= 2.9.5).'
      : 'LX sync WebSocket endpoint. Connect with a WebSocket upgrade request.',
    501,
  );
}

async function handleAuth(req: HTTPRequest, service: LxSyncService): Promise<HTTPResponse> {
  const peer = peerKeyFromRequest(req);
  if (isPeerBlocked(peer)) {
    return textResponse(SYNC_CODE.msgBlockedIp, 403);
  }

  const meta = await service.getServerMeta();
  if (!meta.enabled) return textResponse(SYNC_CODE.msgAuthFailed, 401);

  const m = header(req, 'm');
  const i = header(req, 'i');
  if (!m) {
    recordAuthFailure(peer);
    return textResponse(SYNC_CODE.msgAuthFailed, 401);
  }

  try {
    if (i) {
      // Returning client: AES(authMsg + deviceName) with session key
      const device = await service.getDevice(i);
      if (!device) {
        // Unknown/revoked clientId (e.g. after password regenerate). Do not count toward
        // IP rate-limit — client must re-auth with the new password (codeAuth, no `i`).
        songloft.log.warn(
          `[LxSync] /ah unknown clientId=${String(i).slice(0, 12)}… peer=${peer} (revoked or never issued)`,
        );
        return textResponse(SYNC_CODE.msgAuthFailed, 401);
      }
      let text: string;
      try {
        text = aesDecrypt(m, device.key);
      } catch {
        recordAuthFailure(peer);
        return textResponse(SYNC_CODE.msgAuthFailed, 401);
      }
      if (!text.startsWith(SYNC_CODE.authMsg)) {
        recordAuthFailure(peer);
        return textResponse(SYNC_CODE.msgAuthFailed, 401);
      }
      const deviceName = text.slice(SYNC_CODE.authMsg.length) || device.deviceName;
      await service.touchDevice(i, deviceName);
      recordAuthSuccess(peer);
      return textResponse(aesEncrypt(SYNC_CODE.helloMsg, device.key), 200);
    }

    // First-time code auth
    const passwordKey = await service.getAuthPasswordKey();
    let text: string;
    try {
      text = aesDecrypt(m, passwordKey);
    } catch {
      recordAuthFailure(peer);
      return textResponse(SYNC_CODE.msgAuthFailed, 401);
    }
    if (!text.startsWith(SYNC_CODE.authMsg)) {
      recordAuthFailure(peer);
      return textResponse(SYNC_CODE.msgAuthFailed, 401);
    }
    const lines = text.split('\n');
    const publicKeyBody = lines[1] || '';
    const deviceName = lines[2] || 'Unknown';
    const isMobile = lines[3] === 'lx_music_mobile';
    if (!publicKeyBody) {
      recordAuthFailure(peer);
      return textResponse(SYNC_CODE.msgAuthFailed, 401);
    }

    const issued = await service.issueClientKey(deviceName, isMobile);
    const payload = {
      clientId: issued.clientId,
      key: issued.key,
      serverName: issued.serverName,
    };
    const encrypted = rsaEncryptJson(payload, publicKeyBody);
    recordAuthSuccess(peer);
    songloft.log.info(
      `[LxSync] auth ok device=${deviceName} mobile=${isMobile} clientId=${issued.clientId.slice(0, 8)}…`,
    );
    return textResponse(encrypted, 200);
  } catch (err) {
    songloft.log.error('[LxSync] auth error: ' + String(err));
    recordAuthFailure(peer);
    return textResponse(SYNC_CODE.msgAuthFailed, 401);
  }
}
