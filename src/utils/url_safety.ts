/**
 * Outbound URL validation for user-configured webhooks and similar fetch targets.
 * Blocks loopback, link-local, and common private ranges to reduce SSRF risk.
 */

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipv4ToInt(host: string): number {
  const [a, b, c, d] = host.split('.').map(Number);
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

function inCidr(ip: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

/** True when host resolves to a non-public address we refuse for outbound webhooks. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return true;
  }

  // IPv6 loopback / link-local / ULA
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    // IPv4-mapped IPv6 ::ffff:a.b.c.d
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return isBlockedHostname(mapped[1]);
    return false;
  }

  if (!isIpv4(host)) {
    // Hostnames are allowed (user may point to a LAN name); IP-literal private ranges are blocked.
    return false;
  }

  const ip = ipv4ToInt(host);
  if (inCidr(ip, '0.0.0.0', 8)) return true; // 0.0.0.0/8
  if (inCidr(ip, '10.0.0.0', 8)) return true;
  if (inCidr(ip, '127.0.0.0', 8)) return true;
  if (inCidr(ip, '169.254.0.0', 16)) return true; // link-local / cloud metadata
  if (inCidr(ip, '172.16.0.0', 12)) return true;
  if (inCidr(ip, '192.168.0.0', 16)) return true;
  if (inCidr(ip, '100.64.0.0', 10)) return true; // CGNAT
  return false;
}

/**
 * Validate a webhook / outbound URL.
 * - Only http: and https:
 * - Reject credentials in userinfo
 * - Reject loopback / private / link-local IP literals
 */
export function validateOutboundWebhookUrl(raw: unknown): UrlValidationResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'url is required' };
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'url is not a valid absolute URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'url must use http or https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'url must not include credentials' };
  }
  if (!parsed.hostname) {
    return { ok: false, error: 'url host is required' };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, error: 'url host is not allowed (loopback/private/link-local)' };
  }

  return { ok: true, url: parsed.toString() };
}
