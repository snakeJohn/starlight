import type { HTTPResponse } from '@songloft/plugin-sdk';
import { toStarlightError } from './errors';

export interface ApiOkEnvelope<T> {
  success: true;
  data: T;
  error: null;
}

export interface ApiErrorEnvelope {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

function jsonResponse(body: unknown, statusCode: number): HTTPResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function apiOk<T>(data: T, statusCode = 200): HTTPResponse {
  return jsonResponse(
    {
      success: true,
      data,
      error: null,
    } satisfies ApiOkEnvelope<T>,
    statusCode,
  );
}

export function apiError(error: unknown, statusCode = 500): HTTPResponse {
  const starlightError = toStarlightError(error);

  return jsonResponse(
    {
      success: false,
      data: null,
      error: {
        code: starlightError.code,
        message: starlightError.message,
        retryable: starlightError.retryable,
        details: starlightError.details,
      },
    } satisfies ApiErrorEnvelope,
    statusCode,
  );
}

export function apiHandler<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => TData | Promise<TData>,
  statusCode = 200,
): (...args: TArgs) => Promise<HTTPResponse> {
  return async (...args: TArgs): Promise<HTTPResponse> => {
    try {
      return apiOk(await fn(...args), statusCode);
    } catch (error) {
      return apiError(error);
    }
  };
}
