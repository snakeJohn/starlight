import { StarlightError } from '../system/errors';
import { md5 } from '../utils/crypto';
import { FetchTimeoutError, fetchWithTimeout } from '../utils/fetch_timeout';
import { isBlockedHostname } from '../utils/url_safety';

export interface FetchedOnlineSource {
  sourceUrl: string;
  resolvedUrl: string;
  filename: string;
  content: string;
  contentHash: string;
}

export interface NormalizeOnlineSourceUrlResult {
  sourceUrl: string;
  pathname: string;
}

export type ResolvePublicHost = (hostname: string) => Promise<boolean>;

export interface OnlineSourceFetcherOptions {
  fetchImpl?: typeof fetch;
  resolvePublicHost?: ResolvePublicHost;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

const SENSITIVE_QUERY_RE = /(token|key|secret|auth|signature)/i;
const HTML_MARKERS_RE = /<!doctype\b|<html\b|<head\b|<body\b/i;
const ACCEPTED_CONTENT_TYPES = [
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'text/plain',
  'application/octet-stream',
];

function onlineError(
  code:
    | 'SOURCE_ONLINE_URL_INVALID'
    | 'SOURCE_ONLINE_REDIRECT_INVALID'
    | 'SOURCE_ONLINE_TIMEOUT'
    | 'SOURCE_ONLINE_TOO_LARGE'
    | 'SOURCE_ONLINE_CONTENT_INVALID'
    | 'SOURCE_ONLINE_FETCH_FAILED',
  message: string,
  details: Record<string, unknown> = {},
): StarlightError {
  return new StarlightError(code, message, false, details);
}

/** Redact query values whose names look sensitive (token/key/secret/auth/signature). */
export function redactOnlineSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const params = new URLSearchParams(url.search);
    let changed = false;
    for (const key of [...params.keys()]) {
      if (SENSITIVE_QUERY_RE.test(key)) {
        params.set(key, '***');
        changed = true;
      }
    }
    if (changed) {
      const query = params.toString();
      url.search = query ? `?${query}` : '';
    }
    return url.toString();
  } catch {
    return raw.replace(/([?&][^=&]*(?:token|key|secret|auth|signature)[^=&]*=)[^&]*/gi, '$1***');
  }
}

function requireJsPathname(pathname: string, code: 'SOURCE_ONLINE_URL_INVALID' | 'SOURCE_ONLINE_REDIRECT_INVALID'): void {
  if (!pathname.toLowerCase().endsWith('.js')) {
    throw onlineError(code, '在线音源地址必须指向 JS 文件', {
      pathname,
    });
  }
}

/**
 * Parse and normalize an online source URL.
 * - HTTPS only, no credentials
 * - drop fragment and default :443
 * - keep query (identity key)
 * - require .js pathname (case-insensitive)
 */
export function normalizeOnlineSourceUrl(raw: string): NormalizeOnlineSourceUrlResult {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    throw onlineError('SOURCE_ONLINE_URL_INVALID', '仅支持 HTTPS 音源地址');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw onlineError('SOURCE_ONLINE_URL_INVALID', '仅支持 HTTPS 音源地址');
  }

  if (parsed.protocol !== 'https:') {
    throw onlineError('SOURCE_ONLINE_URL_INVALID', '仅支持 HTTPS 音源地址');
  }
  if (parsed.username || parsed.password) {
    throw onlineError('SOURCE_ONLINE_URL_INVALID', '仅支持 HTTPS 音源地址');
  }
  if (!parsed.hostname) {
    throw onlineError('SOURCE_ONLINE_URL_INVALID', '仅支持 HTTPS 音源地址');
  }

  requireJsPathname(parsed.pathname, 'SOURCE_ONLINE_URL_INVALID');

  parsed.hash = '';
  if (parsed.port === '443') {
    parsed.port = '';
  }

  // URL API already lowercases protocol/host; rebuild for a stable identity string.
  const sourceUrl = parsed.toString();
  return {
    sourceUrl,
    pathname: parsed.pathname,
  };
}

function filenameFromPathname(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean).pop() || 'source.js';
  return segment.toLowerCase().endsWith('.js') ? segment : `${segment}.js`;
}

function isAcceptedContentType(contentType: string | null): boolean {
  if (!contentType || !contentType.trim()) {
    return true;
  }
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return ACCEPTED_CONTENT_TYPES.some((type) => normalized === type || normalized.endsWith('+javascript'));
}

function validateScriptContent(content: string): void {
  if (!content || content.trim() === '') {
    throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '未识别到有效的 LX 音源脚本');
  }
  if (content.includes('\u0000')) {
    throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '未识别到有效的 LX 音源脚本');
  }
  if (HTML_MARKERS_RE.test(content)) {
    throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '地址返回的不是 JavaScript 音源文件');
  }
  if (!content.includes('lx.send')) {
    throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '未识别到有效的 LX 音源脚本');
  }
}

type DnsLookupAll = (hostname: string) => Promise<string[]>;

/** Cached Node/host DNS lookup. `undefined` = not probed yet; `null` = unavailable. */
let cachedDnsLookupAll: DnsLookupAll | null | undefined;

function collectLookupAddresses(result: unknown): string[] {
  const addresses: string[] = [];
  if (typeof result === 'string') {
    addresses.push(result);
  } else if (Array.isArray(result)) {
    for (const entry of result) {
      if (typeof entry === 'string') addresses.push(entry);
      else if (entry && typeof entry === 'object' && typeof (entry as { address?: unknown }).address === 'string') {
        addresses.push((entry as { address: string }).address);
      }
    }
  } else if (result && typeof result === 'object' && typeof (result as { address?: unknown }).address === 'string') {
    addresses.push((result as { address: string }).address);
  }
  return addresses;
}

function isIpLiteralHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Resolve a public-host DNS helper without a static Node builtin import.
 * plugin-builder rejects static node builtins; Songloft QuickJS has no dns module.
 * Order: host-injected globalThis.dns → dynamic node:dns/promises → dns/promises.
 */
async function getDnsLookupAll(): Promise<DnsLookupAll | null> {
  if (cachedDnsLookupAll !== undefined) {
    return cachedDnsLookupAll;
  }

  const g = globalThis as {
    dns?: {
      lookup?: (hostname: string, options?: unknown) => unknown;
      promises?: { lookup?: (hostname: string, options?: unknown) => unknown };
    };
  };

  const hostLookup = g.dns?.promises?.lookup ?? g.dns?.lookup;
  if (typeof hostLookup === 'function') {
    cachedDnsLookupAll = async (hostname: string) => {
      const result = await Promise.resolve(hostLookup(hostname, { all: true }));
      return collectLookupAddresses(result);
    };
    return cachedDnsLookupAll;
  }

  // Dynamic import keeps the module graph free of static Node builtins for the plugin bundle.
  for (const specifier of ['node:dns/promises', 'dns/promises'] as const) {
    try {
      const mod = (await import(/* webpackIgnore: true */ specifier)) as {
        lookup?: (hostname: string, options: { all: boolean }) => Promise<unknown>;
      };
      if (typeof mod.lookup !== 'function') continue;
      const lookup = mod.lookup.bind(mod);
      cachedDnsLookupAll = async (hostname: string) => {
        const result = await lookup(hostname, { all: true });
        return collectLookupAddresses(result);
      };
      return cachedDnsLookupAll;
    } catch {
      // try next resolver
    }
  }

  cachedDnsLookupAll = null;
  return null;
}

/** Test-only: reset DNS helper cache between cases. */
export function resetOnlineSourceDnsCacheForTests(): void {
  cachedDnsLookupAll = undefined;
}

/** Test-only: force "no DNS available" path (QuickJS simulation). */
export function forceOnlineSourceDnsUnavailableForTests(): void {
  cachedDnsLookupAll = null;
}

async function defaultResolvePublicHost(hostname: string): Promise<boolean> {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return false;
  }
  if (isBlockedHostname(host)) {
    return false;
  }

  // IP literals: isBlockedHostname already applied above.
  if (isIpLiteralHost(host)) {
    return true;
  }

  const lookupAll = await getDnsLookupAll();
  if (!lookupAll) {
    // QuickJS / Songloft often has no DNS module. Fail-open for non-blocked hostnames
    // (still reject localhost/private IP literals via isBlockedHostname above).
    // When DNS is available we keep rebinding protection below.
    return true;
  }

  try {
    const addresses = await lookupAll(host);
    if (addresses.length === 0) {
      return false;
    }
    // Every resolved address must be public (block dual-homed / rebinding to private).
    return addresses.every((address) => !isBlockedHostname(address));
  } catch {
    return false;
  }
}

function remainingUntil(deadlineAt: number): number {
  return deadlineAt - Date.now();
}

function throwIfDeadlineExceeded(deadlineAt: number, sourceUrlForLog?: string): void {
  if (remainingUntil(deadlineAt) <= 0) {
    throw onlineError('SOURCE_ONLINE_TIMEOUT', '下载音源超时，请检查地址后重试', sourceUrlForLog
      ? { url: redactOnlineSourceUrl(sourceUrlForLog) }
      : {});
  }
}

function raceWithDeadline<T>(promise: Promise<T>, deadlineAt: number, sourceUrlForLog?: string): Promise<T> {
  const ms = remainingUntil(deadlineAt);
  if (ms <= 0) {
    return Promise.reject(
      onlineError('SOURCE_ONLINE_TIMEOUT', '下载音源超时，请检查地址后重试', sourceUrlForLog
        ? { url: redactOnlineSourceUrl(sourceUrlForLog) }
        : {}),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        onlineError('SOURCE_ONLINE_TIMEOUT', '下载音源超时，请检查地址后重试', sourceUrlForLog
          ? { url: redactOnlineSourceUrl(sourceUrlForLog) }
          : {}),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function readBodyBounded(
  res: Response,
  maxBytes: number,
  deadlineAt: number,
  sourceUrlForLog?: string,
): Promise<Uint8Array> {
  throwIfDeadlineExceeded(deadlineAt, sourceUrlForLog);

  const contentLength = res.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw onlineError('SOURCE_ONLINE_TOO_LARGE', '在线音源文件过大');
    }
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // Fallback for environments without streaming: arrayBuffer still needs a hard cap + deadline.
    const buffer = new Uint8Array(
      await raceWithDeadline(res.arrayBuffer(), deadlineAt, sourceUrlForLog),
    );
    if (buffer.byteLength > maxBytes) {
      throw onlineError('SOURCE_ONLINE_TOO_LARGE', '在线音源文件过大');
    }
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfDeadlineExceeded(deadlineAt, sourceUrlForLog);
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        // Prevent unhandled rejection if read settles after deadline cancel.
        const readPromise = reader.read().catch((err) => {
          throw err;
        });
        readResult = await raceWithDeadline(readPromise, deadlineAt, sourceUrlForLog);
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel failures
        }
        throw error;
      }
      const { done, value } = readResult;
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel failures
        }
        throw onlineError('SOURCE_ONLINE_TOO_LARGE', '在线音源文件过大');
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '未识别到有效的 LX 音源脚本');
  }
}

export class OnlineSourceFetcher {
  private readonly fetchImpl: typeof fetch | null;
  private readonly resolvePublicHost: ResolvePublicHost;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: OnlineSourceFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? null;
    this.resolvePublicHost = options.resolvePublicHost ?? defaultResolvePublicHost;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  }

  async fetch(rawUrl: string): Promise<FetchedOnlineSource> {
    const normalized = normalizeOnlineSourceUrl(rawUrl);
    const startedAt = Date.now();
    const deadlineAt = startedAt + this.timeoutMs;
    await this.assertPublicHost(normalized.sourceUrl, 'SOURCE_ONLINE_URL_INVALID', deadlineAt);

    let currentUrl = normalized.sourceUrl;
    let redirects = 0;

    while (true) {
      const remainingMs = remainingUntil(deadlineAt);
      if (remainingMs <= 0) {
        throw onlineError('SOURCE_ONLINE_TIMEOUT', '下载音源超时，请检查地址后重试', {
          url: redactOnlineSourceUrl(normalized.sourceUrl),
        });
      }

      let res: Response;
      try {
        res = await this.performRequest(currentUrl, remainingMs);
      } catch (error) {
        throw this.mapFetchError(error, normalized.sourceUrl);
      }

      if (res.status >= 300 && res.status < 400) {
        // Drop redirect bodies early so large/slow 3xx payloads cannot hang the session.
        try {
          if (res.body && typeof res.body.cancel === 'function') {
            await res.body.cancel();
          }
        } catch {
          // ignore
        }

        const location = res.headers.get('location');
        if (!location) {
          throw onlineError('SOURCE_ONLINE_REDIRECT_INVALID', '音源重定向地址不受支持', {
            url: redactOnlineSourceUrl(currentUrl),
          });
        }
        redirects += 1;
        if (redirects > this.maxRedirects) {
          throw onlineError('SOURCE_ONLINE_REDIRECT_INVALID', '音源重定向地址不受支持', {
            redirects,
          });
        }

        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          throw onlineError('SOURCE_ONLINE_REDIRECT_INVALID', '音源重定向地址不受支持');
        }

        let nextNormalized: NormalizeOnlineSourceUrlResult;
        try {
          nextNormalized = normalizeOnlineSourceUrl(nextUrl);
        } catch {
          throw onlineError('SOURCE_ONLINE_REDIRECT_INVALID', '音源重定向地址不受支持', {
            url: redactOnlineSourceUrl(nextUrl),
          });
        }
        await this.assertPublicHost(nextNormalized.sourceUrl, 'SOURCE_ONLINE_REDIRECT_INVALID', deadlineAt);
        currentUrl = nextNormalized.sourceUrl;
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        throw onlineError('SOURCE_ONLINE_FETCH_FAILED', '下载音源失败，请检查地址后重试', {
          status: res.status,
          url: redactOnlineSourceUrl(currentUrl),
        });
      }

      if (!isAcceptedContentType(res.headers.get('content-type'))) {
        throw onlineError('SOURCE_ONLINE_CONTENT_INVALID', '地址返回的不是 JavaScript 音源文件');
      }

      // Body read shares the same absolute deadline as request headers / redirects.
      let bytes: Uint8Array;
      try {
        bytes = await readBodyBounded(res, this.maxBytes, deadlineAt, normalized.sourceUrl);
      } catch (error) {
        throw this.mapFetchError(error, normalized.sourceUrl);
      }
      const content = decodeUtf8(bytes);
      validateScriptContent(content);

      const resolved = normalizeOnlineSourceUrl(currentUrl);
      return {
        sourceUrl: normalized.sourceUrl,
        resolvedUrl: resolved.sourceUrl,
        filename: filenameFromPathname(resolved.pathname),
        content,
        contentHash: md5(content),
      };
    }
  }

  private async performRequest(url: string, timeoutMs: number): Promise<Response> {
    const ms = Math.max(1, Math.floor(timeoutMs));
    const init: RequestInit = {
      method: 'GET',
      redirect: 'manual',
    };

    // Default path: shared timeout helper against global fetch.
    if (!this.fetchImpl) {
      return fetchWithTimeout(url, { ...init, timeoutMs: ms });
    }

    const fetchImpl = this.fetchImpl;
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        timer = setTimeout(() => controller.abort(), ms);
        return await fetchImpl(url, {
          ...init,
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new FetchTimeoutError(`Request timed out after ${ms}ms`);
        }
        throw err;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetchImpl(url, init),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new FetchTimeoutError(`Request timed out after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async assertPublicHost(
    url: string,
    code: 'SOURCE_ONLINE_URL_INVALID' | 'SOURCE_ONLINE_REDIRECT_INVALID',
    deadlineAt: number,
  ): Promise<void> {
    const hostname = new URL(url).hostname;
    if (isBlockedHostname(hostname)) {
      throw onlineError(code, code === 'SOURCE_ONLINE_REDIRECT_INVALID'
        ? '音源重定向地址不受支持'
        : '仅支持 HTTPS 音源地址', {
        url: redactOnlineSourceUrl(url),
      });
    }
    let ok: boolean;
    try {
      ok = await raceWithDeadline(this.resolvePublicHost(hostname), deadlineAt, url);
    } catch (error) {
      if (error instanceof StarlightError && error.code === 'SOURCE_ONLINE_TIMEOUT') {
        throw error;
      }
      throw this.mapFetchError(error, url);
    }
    if (!ok) {
      throw onlineError(code, code === 'SOURCE_ONLINE_REDIRECT_INVALID'
        ? '音源重定向地址不受支持'
        : '仅支持 HTTPS 音源地址', {
        url: redactOnlineSourceUrl(url),
      });
    }
  }

  private mapFetchError(error: unknown, sourceUrl: string): StarlightError {
    if (error instanceof StarlightError) {
      return error;
    }
    if (error instanceof FetchTimeoutError) {
      return onlineError('SOURCE_ONLINE_TIMEOUT', '下载音源超时，请检查地址后重试', {
        url: redactOnlineSourceUrl(sourceUrl),
      });
    }
    return onlineError('SOURCE_ONLINE_FETCH_FAILED', '下载音源失败，请检查地址后重试', {
      url: redactOnlineSourceUrl(sourceUrl),
    });
  }
}
