import type { HTTPResponse } from '@songloft/plugin-sdk';
import { StarlightError, toStarlightError } from './errors';

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

/** Map StarlightError codes to HTTP status (shared by all modern handlers). */
export function httpStatusForError(error: unknown): number {
  if (!(error instanceof StarlightError)) {
    return 500;
  }

  switch (error.code) {
    case 'BAD_REQUEST':
    case 'MUSIC_PLATFORM_UNSUPPORTED':
    case 'SOURCE_ONLINE_URL_INVALID':
    case 'SOURCE_ONLINE_REDIRECT_INVALID':
    case 'SOURCE_ONLINE_CONTENT_INVALID':
    case 'SOURCE_ONLINE_TOO_LARGE':
    case 'SOURCE_IMPORT_INVALID':
    case 'AUTH_PASSWORD_FAILED':
    case 'AUTH_QR_EXPIRED':
    case 'DEVICE_NOT_SELECTED':
    case 'EXTERNAL_SEARCH_DISABLED':
    case 'VOICE_LISTENER_DISABLED':
      return 400;
    case 'AUTH_TOKEN_EXPIRED':
      return 401;
    case 'PLAY_URL_RESOLVE_FAILED':
    case 'MUSIC_SEARCH_EMPTY':
      return 404;
    case 'INDEX_REFRESH_RUNNING':
    case 'SCHEDULE_LOCKED':
      return 409;
    case 'DEVICE_OFFLINE':
      return 503;
    case 'SOURCE_ONLINE_TIMEOUT':
    case 'SOURCE_ONLINE_FETCH_FAILED':
    case 'SOURCE_ONLINE_IMPORT_FAILED':
    case 'VOICE_AI_FAILED':
    case 'AUDIO_CONVERT_FAILED':
    case 'SOURCE_RUNTIME_FAILED':
      return 502;
    case 'INTERNAL_ERROR':
      if (error.details.upstream === 'songloft_remote_import') {
        return 502;
      }
      return 500;
    default:
      return 500;
  }
}

/** Run an async/sync handler and wrap the result in the standard API envelope. */
export async function runApi<T>(
  fn: () => T | Promise<T>,
  statusCode = 200,
): Promise<HTTPResponse> {
  try {
    return apiOk(await fn(), statusCode);
  } catch (error) {
    return apiError(error, httpStatusForError(error));
  }
}

/**
 * Like runApi, but success body is raw JSON (no { success, data } envelope).
 * Used by a few LX-compatible endpoints such as /api/music/url.
 */
export async function runRawJson<T>(
  fn: () => T | Promise<T>,
  statusCode = 200,
): Promise<HTTPResponse> {
  try {
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await fn()),
    };
  } catch (error) {
    return apiError(error, httpStatusForError(error));
  }
}

export function apiHandler<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => TData | Promise<TData>,
  statusCode = 200,
): (...args: TArgs) => Promise<HTTPResponse> {
  return async (...args: TArgs): Promise<HTTPResponse> => runApi(() => fn(...args), statusCode);
}
