import type { HTTPRequest } from '@songloft/plugin-sdk';
import { StarlightError } from './errors';

export type JsonBodyRequest = Omit<HTTPRequest, 'body'> & {
  body?: HTTPRequest['body'] | string | null;
};

function decodeUtf8(bytes: Uint8Array): string {
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
