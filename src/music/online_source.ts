import { StarlightError } from '../system/errors';
import { fetchWithTimeout } from '../utils/fetch_timeout';

const MAX_SOURCE_BYTES = 512 * 1024;
const GITHUB_HOST = 'github.com';
const RAW_GITHUB_HOST = 'raw.githubusercontent.com';

function invalid(message: string): never {
  throw new StarlightError('BAD_REQUEST', message);
}

function responseHeader(response: Response, name: string): string {
  const headers = (response as { headers?: unknown }).headers;
  if (!headers || typeof headers !== 'object') return '';
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const value = get.call(headers, name);
    return value === null || value === undefined ? '' : String(value);
  }
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === expected) return String(value ?? '');
  }
  return '';
}

export function normalizeGithubSourceUrl(value: unknown): { url: string; filename: string } {
  if (typeof value !== 'string' || !value.trim()) invalid('url is required');

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    invalid('url must be a valid GitHub JavaScript URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    invalid('only HTTPS GitHub URLs are supported');
  }

  let rawUrl: URL;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname.toLowerCase() === GITHUB_HOST) {
    if (segments.length < 5 || segments[2] !== 'blob') {
      invalid('GitHub URL must point to a blob file');
    }
    rawUrl = new URL(`https://${RAW_GITHUB_HOST}/${segments[0]}/${segments[1]}/${segments.slice(3).join('/')}`);
  } else if (parsed.hostname.toLowerCase() === RAW_GITHUB_HOST) {
    if (segments.length < 4) invalid('raw GitHub URL must point to a file');
    rawUrl = parsed;
  } else {
    invalid('only github.com and raw.githubusercontent.com are supported');
  }

  const filename = decodeURIComponent(segments[segments.length - 1] || '');
  if (!filename.toLowerCase().endsWith('.js')) invalid('online source must be a .js file');
  return { url: rawUrl.toString(), filename };
}

export async function fetchGithubSource(value: unknown): Promise<{ filename: string; content: string }> {
  const source = normalizeGithubSourceUrl(value);
  let response: Response;
  try {
    response = await fetchWithTimeout(source.url, {
      timeoutMs: 15_000,
      redirect: 'error',
      headers: { Accept: 'application/javascript, text/javascript, text/plain' },
    });
  } catch (error) {
    throw new StarlightError('BAD_REQUEST', `failed to download online source: ${String(error)}`);
  }
  if (!response.ok) invalid(`online source returned HTTP ${response.status}`);

  const declaredSize = Number(responseHeader(response, 'content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) invalid('online source is too large');
  const contentType = responseHeader(response, 'content-type').toLowerCase();
  if (contentType && !/(javascript|text\/plain|octet-stream)/.test(contentType)) {
    invalid('online source did not return JavaScript');
  }
  const content = await response.text();
  if (!content.trim()) invalid('online source is empty');
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES) invalid('online source is too large');
  return { filename: source.filename, content };
}
