import { StarlightError } from '../system/errors';
import { LX_SHIM } from './lx_shim';
import type { LxSongInfo, MusicPlatform, MusicQuality } from './types';

interface SourceConfig {
  sources: Record<string, unknown>;
}

interface RuntimeEvent {
  name?: unknown;
  data?: unknown;
}

interface RuntimeResult {
  error?: string;
  events?: unknown[];
}

interface DispatchEnvelope {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

interface SourceRuntimeOptions {
  runtimeNamespace?: string;
}

let nextDispatchId = 1;

function envNameFor(sourceId: string, runtimeNamespace = ''): string {
  const namespacedSourceId = runtimeNamespace ? `${runtimeNamespace}_${sourceId}` : sourceId;
  const hashSource = runtimeNamespace ? `${runtimeNamespace}:${sourceId}` : sourceId;
  const sanitized = namespacedSourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `starlight_lx_${sanitized}_${stableShortHash(hashSource)}`;
}

function stableShortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function parseEventData(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }

  return JSON.parse(data) as unknown;
}

function findEvent(events: unknown[] | undefined, name: string): RuntimeEvent | null {
  for (const event of events ?? []) {
    if (event !== null && typeof event === 'object' && (event as RuntimeEvent).name === name) {
      return event as RuntimeEvent;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSourceConfig(value: unknown): SourceConfig | null {
  const config = asRecord(value);
  if (!config) {
    return null;
  }

  const sources = asRecord(config.sources);
  if (!sources) {
    return null;
  }

  return { sources };
}

function stringUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (value !== null && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    return typeof url === 'string' && url.length > 0 ? url : null;
  }

  return null;
}

export class SourceRuntime {
  private destroyed = false;
  private dispatchQueue: Promise<void> = Promise.resolve();
  private destroyPromise: Promise<void> | null = null;
  private lastMusicUrlFailure: string | null = null;

  private constructor(
    private readonly envName: string,
    private readonly config: SourceConfig,
  ) {}

  static async create(sourceId: string, script: string, options: SourceRuntimeOptions = {}): Promise<SourceRuntime> {
    const envName = envNameFor(sourceId, options.runtimeNamespace);

    try {
      await songloft.jsenv.create(envName, LX_SHIM);
      const initResult = await songloft.jsenv.executeWait(envName, script, 30000, ['inited']) as RuntimeResult;
      const initEvent = findEvent(initResult.events, 'inited');
      if (!initEvent) {
        await destroyEnv(envName);
        if (initResult.error) {
          throw new StarlightError('SOURCE_RUNTIME_FAILED', String(initResult.error), false);
        }

        throw new StarlightError('SOURCE_IMPORT_INVALID', '音源未调用 lx.send("inited")', false);
      }

      const config = parseSourceConfig(initEvent.data);
      if (!config) {
        await destroyEnv(envName);
        throw new StarlightError('SOURCE_IMPORT_INVALID', '音源 inited 配置无效', false);
      }

      if (initResult.error) {
        songloft.log.warn(`Music source ${sourceId} reported an error after init: ${String(initResult.error)}`);
      }

      return new SourceRuntime(envName, config);
    } catch (error) {
      if (error instanceof StarlightError) {
        throw error;
      }

      await destroyEnv(envName);
      throw new StarlightError('SOURCE_RUNTIME_FAILED', String(error), false);
    }
  }

  supportsPlatform(platform: MusicPlatform | string): boolean {
    return Boolean(this.config.sources[platform]);
  }

  async getMusicUrl(
    platform: MusicPlatform | string,
    quality: MusicQuality | string,
    songInfo: LxSongInfo,
  ): Promise<string | null> {
    return this.enqueueDispatch(() => this.dispatchMusicUrl(platform, quality, songInfo), null);
  }

  getLastMusicUrlFailure(): string | null {
    return this.lastMusicUrlFailure;
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) {
      return this.destroyPromise;
    }

    this.destroyed = true;
    this.destroyPromise = this.destroyAfterDispatches();
    return this.destroyPromise;
  }

  private async enqueueDispatch<T>(task: () => Promise<T>, destroyedValue: T): Promise<T> {
    if (this.destroyed) {
      return destroyedValue;
    }

    const previous = this.dispatchQueue;
    let release = () => {};
    this.dispatchQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      if (this.destroyed) {
        return destroyedValue;
      }

      return await task();
    } finally {
      release();
    }
  }

  private async destroyAfterDispatches(): Promise<void> {
    await this.dispatchQueue;
    await songloft.jsenv.destroy(this.envName);
  }

  private async dispatchMusicUrl(
    platform: MusicPlatform | string,
    quality: MusicQuality | string,
    songInfo: LxSongInfo,
  ): Promise<string | null> {
    this.lastMusicUrlFailure = null;
    const dispatchId = `musicUrl_${nextDispatchId++}`;
    const payload = {
      source: platform,
      action: 'musicUrl',
      info: {
        musicInfo: songInfo,
        type: quality,
      },
    };
    const code = `globalThis.lx._dispatch(${JSON.stringify(dispatchId)}, "request", ${JSON.stringify(payload)});`;

    try {
      const dispatchResult = await songloft.jsenv.executeWait(
        this.envName,
        code,
        30000,
        ['dispatchResult', 'dispatchError'],
      ) as RuntimeResult;
      if (dispatchResult.error) {
        this.lastMusicUrlFailure = sanitizeError(dispatchResult.error);
        return null;
      }

      const errorEvent = this.findDispatchEvent(dispatchResult.events, 'dispatchError', dispatchId);
      if (errorEvent) {
        const data = parseEventData(errorEvent.data) as DispatchEnvelope;
        this.lastMusicUrlFailure = sanitizeError(typeof data.error === 'string' ? data.error : '音源返回错误');
        return null;
      }

      const resultEvent = this.findDispatchEvent(dispatchResult.events, 'dispatchResult', dispatchId);
      if (!resultEvent) {
        this.lastMusicUrlFailure = '音源未返回 URL';
        return null;
      }

      const data = parseEventData(resultEvent.data) as DispatchEnvelope;
      const url = stringUrl(data.result);
      if (!url) {
        this.lastMusicUrlFailure = '音源未返回 URL';
      }
      return url;
    } catch (error) {
      this.lastMusicUrlFailure = sanitizeError(error);
      return null;
    }
  }

  private findDispatchEvent(events: unknown[] | undefined, name: string, dispatchId: string): RuntimeEvent | null {
    for (const event of events ?? []) {
      if (event === null || typeof event !== 'object') {
        continue;
      }

      const runtimeEvent = event as RuntimeEvent;
      if (runtimeEvent.name !== name) {
        continue;
      }

      try {
        const data = parseEventData(runtimeEvent.data) as DispatchEnvelope;
        if (data.id === dispatchId) {
          return runtimeEvent;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function parseSourceConfig(data: unknown): SourceConfig | null {
  try {
    return normalizeSourceConfig(parseEventData(data));
  } catch {
    return null;
  }
}

async function destroyEnv(envName: string): Promise<void> {
  try {
    await songloft.jsenv.destroy(envName);
  } catch {
    // Preserve the original source runtime failure.
  }
}
