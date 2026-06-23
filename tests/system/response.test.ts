import { describe, expect, test } from 'vitest';
import type { HTTPResponse } from '@songloft/plugin-sdk';
import { parseJsonBody } from '../../src/system/body';
import { StarlightError } from '../../src/system/errors';
import { apiError, apiHandler, apiOk } from '../../src/system/response';

function parseResponseBody(response: HTTPResponse): unknown {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function requestWithBody(body: string | Uint8Array | null): Parameters<typeof parseJsonBody>[0] {
  return {
    method: 'POST',
    path: '/',
    headers: {},
    body,
    query: '',
  };
}

describe('api response helpers', () => {
  test('apiOk wraps data in a success envelope', () => {
    const response = apiOk({ value: 1 });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: { value: 1 },
      error: null,
    });
  });

  test('apiError wraps StarlightError in a structured error envelope', () => {
    const response = apiError(new StarlightError('SOURCE_NOT_ENABLED', '音源未启用', false), 400);

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response)).toEqual({
      success: false,
      data: null,
      error: {
        code: 'SOURCE_NOT_ENABLED',
        message: '音源未启用',
        retryable: false,
        details: {},
      },
    });
  });

  test('apiHandler converts resolved data to an ok response', async () => {
    const handler = apiHandler(async () => ({ value: 1 }), 201);

    const response = await handler();

    expect(response.statusCode).toBe(201);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: { value: 1 },
      error: null,
    });
  });

  test('apiHandler converts thrown errors to error responses', async () => {
    const handler = apiHandler(async () => {
      throw new StarlightError('BAD_REQUEST', 'bad request');
    });

    const response = await handler();

    expect(response.statusCode).toBe(500);
    expect(parseResponseBody(response)).toMatchObject({
      success: false,
      data: null,
      error: {
        code: 'BAD_REQUEST',
        message: 'bad request',
        retryable: false,
        details: {},
      },
    });
  });
});

describe('parseJsonBody', () => {
  test('returns an empty object for an empty request body', () => {
    expect(parseJsonBody(requestWithBody(null))).toEqual({});
    expect(parseJsonBody(requestWithBody(''))).toEqual({});
    expect(parseJsonBody(requestWithBody(new Uint8Array()))).toEqual({});
  });

  test('parses string and Uint8Array JSON bodies', () => {
    expect(parseJsonBody(requestWithBody('{"value":1}'))).toEqual({ value: 1 });
    expect(parseJsonBody(requestWithBody(new TextEncoder().encode('{"value":2}')))).toEqual({ value: 2 });
  });

  test('throws a BAD_REQUEST StarlightError for invalid JSON', () => {
    expect(() => parseJsonBody(requestWithBody('{'))).toThrow(StarlightError);
    expect(() => parseJsonBody(requestWithBody('{'))).toThrow('请求体不是合法 JSON');
  });
});
