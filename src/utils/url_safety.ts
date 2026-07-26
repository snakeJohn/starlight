/**
 * Outbound URL validation for user-configured webhooks and online source import.
 * Blocks loopback, private, link-local, multicast, reserved, and documentation ranges.
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

/**
 * Expand an IPv6 literal into 8 hextets.
 * Supports compressed form and an embedded IPv4 tail (e.g. ::ffff:127.0.0.1).
 */
function expandIpv6Hextets(host: string): number[] | null {
  let raw = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!raw.includes(':')) return null;
  if (raw.includes(':::')) return null;

  const v4Tail = raw.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail && isIpv4(v4Tail[1])) {
    const [a, b, c, d] = v4Tail[1].split('.').map(Number);
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    raw = `${raw.slice(0, -v4Tail[1].length)}${hi}:${lo}`;
  }

  const sides = raw.split('::');
  if (sides.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  if (sides.length === 1) {
    const parts = parseSide(sides[0]);
    if (!parts || parts.length !== 8) return null;
    return parts;
  }

  const left = parseSide(sides[0]);
  const right = parseSide(sides[1]);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function isBlockedIpv6(host: string): boolean {
  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    // Unparseable with ':' — fail closed for SSRF targets.
    return true;
  }

  const h = hextets;
  // :: / unspecified
  if (h.every((x) => x === 0)) return true;
  // ::1 loopback
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) {
    return true;
  }

  // IPv4-mapped ::ffff:a.b.c.d
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const a = (h[6] >> 8) & 0xff;
    const b = h[6] & 0xff;
    const c = (h[7] >> 8) & 0xff;
    const d = h[7] & 0xff;
    return isBlockedHostname(`${a}.${b}.${c}.${d}`);
  }

  // Deprecated IPv4-compatible ::a.b.c.d and other ::/96
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return true;
  }

  // Link-local fe80::/10
  if (h[0] >= 0xfe80 && h[0] <= 0xfebf) return true;
  // ULA fc00::/7
  if ((h[0] & 0xfe00) === 0xfc00) return true;
  // Multicast ff00::/8
  if ((h[0] & 0xff00) === 0xff00) return true;
  // Documentation 2001:db8::/32
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true;

  return false;
}

/** True when host is a non-public address we refuse for outbound webhooks / online import. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return true;
  }

  if (host.includes(':')) {
    return isBlockedIpv6(host);
  }

  if (!isIpv4(host)) {
    // Hostnames are allowed at the string layer; DNS resolution must still verify public A/AAAA.
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
  if (inCidr(ip, '192.0.0.0', 24)) return true; // IETF protocol assignments
  if (inCidr(ip, '192.0.2.0', 24)) return true; // TEST-NET-1
  if (inCidr(ip, '198.51.100.0', 24)) return true; // TEST-NET-2
  if (inCidr(ip, '203.0.113.0', 24)) return true; // TEST-NET-3
  if (inCidr(ip, '198.18.0.0', 15)) return true; // benchmarking
  if (inCidr(ip, '224.0.0.0', 4)) return true; // multicast
  if (inCidr(ip, '240.0.0.0', 4)) return true; // reserved
  if (ip === ipv4ToInt('255.255.255.255')) return true; // broadcast
  return false;
}

/**
 * Validate a webhook / outbound URL.
 * - Only http: and https:
 * - Reject credentials in userinfo
 * - Reject loopback / private / link-local / multicast / reserved IP literals
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
