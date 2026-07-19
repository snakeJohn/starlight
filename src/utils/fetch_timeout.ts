/**
 * Timeout-aware fetch with AbortController when available.
 * Always clears timers; aborts the request on timeout so work does not leak.
 */

export type FetchTimeoutOptions = RequestInit & {
  timeoutMs: number;
};

export class FetchTimeoutError extends Error {
  readonly name = 'FetchTimeoutError';
  constructor(message = 'Request timed out') {
    super(message);
  }
}

/** Redact likely secret fragments from a short diagnostic snippet. */
export function redactForLog(text: string, maxLen = 200): string {
  const clipped = text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  return clipped
    .replace(/(Bearer\s+)[^\s]+/gi, '$1***')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1***')
    .replace(/(pass_?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1***')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1***');
}

/**
 * fetch with a hard timeout. Uses AbortController when present; otherwise
 * races a timer and still attempts to ignore late responses.
 */
export async function fetchWithTimeout(
  input: string,
  options: FetchTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, ...init } = options;
  const ms = Math.max(1, Math.floor(timeoutMs));

  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const parentSignal = init.signal;
    let parentAbort: (() => void) | undefined;
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentAbort = () => controller.abort();
        parentSignal.addEventListener('abort', parentAbort);
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => controller.abort(), ms);
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new FetchTimeoutError(`Request timed out after ${ms}ms`);
      }
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (parentSignal && parentAbort) {
        parentSignal.removeEventListener('abort', parentAbort);
      }
    }
  }

  // Fallback for environments without AbortController (older QuickJS).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      fetch(input, init),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new FetchTimeoutError(`Request timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void timedOut;
  }
}
