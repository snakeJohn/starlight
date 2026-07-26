export const ERROR_CODES = [
  'AUTH_QR_EXPIRED',
  'AUTH_PASSWORD_FAILED',
  'AUTH_TOKEN_EXPIRED',
  'DEVICE_OFFLINE',
  'DEVICE_NOT_SELECTED',
  'PLAY_URL_RESOLVE_FAILED',
  'AUDIO_CONVERT_FAILED',
  'SOURCE_IMPORT_INVALID',
  'SOURCE_RUNTIME_FAILED',
  'SOURCE_NOT_ENABLED',
  'MUSIC_SEARCH_EMPTY',
  'MUSIC_PLATFORM_UNSUPPORTED',
  'VOICE_LISTENER_DISABLED',
  'VOICE_AI_FAILED',
  'EXTERNAL_SEARCH_DISABLED',
  'INDEX_REFRESH_RUNNING',
  'SCHEDULE_LOCKED',
  'BAD_REQUEST',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class StarlightError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    retryable = false,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StarlightError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function toStarlightError(error: unknown): StarlightError {
  if (error instanceof StarlightError) {
    return error;
  }

  if (error instanceof Error) {
    return new StarlightError('INTERNAL_ERROR', error.message || 'Internal error');
  }

  return new StarlightError('INTERNAL_ERROR', String(error || 'Internal error'));
}
