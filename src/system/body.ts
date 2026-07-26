import type { HTTPRequest } from '@songloft/plugin-sdk';
import { StarlightError } from './errors';

export type JsonBodyRequest = Omit<HTTPRequest, 'body'> & {
  body?: HTTPRequest['body'] | string | null;
};

function decodeUtf8(bytes: Uint8Array): string {
  // TextDecoder is O(n) native; the percent-encode fallback allocates ~3x the
  // body as an intermediate string and is only there for runtimes without it.
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  let encoded = '';
  for (const byte of bytes) {
    encoded += `%${byte.toString(16).padStart(2, '0')}`;
  }
  return decodeURIComponent(encoded);
}

export function parseJsonBody<T = Record<string, unknown>>(req: JsonBodyRequest): T {
  const body = req.body;
  if (body == null) {
    return {} as T;
  }

  try {
    const text = typeof body === 'string' ? body : decodeUtf8(body);
    if (text.trim() === '') {
      return {} as T;
    }

    return JSON.parse(text) as T;
  } catch {
    throw new StarlightError('BAD_REQUEST', '请求体不是合法 JSON', false);
  }
}
