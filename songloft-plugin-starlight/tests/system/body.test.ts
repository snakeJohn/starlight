import { describe, expect, test } from 'vitest';
import { parseJsonBody } from '../../src/system/body';

function requestWithBody(body: string | Uint8Array | null): Parameters<typeof parseJsonBody>[0] {
  return {
    method: 'POST',
    path: '/',
    headers: {},
    body,
    query: '',
  };
}

describe('parseJsonBody', () => {
  test('allows callers to parse a typed request body', () => {
    const body = parseJsonBody<{ keyword: string }>(requestWithBody('{"keyword":"starlight"}'));

    expect(body.keyword).toBe('starlight');
  });
});
