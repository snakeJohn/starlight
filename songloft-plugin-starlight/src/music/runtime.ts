import { StarlightError } from '../system/errors';
import { LX_SHIM } from './lx_shim';
import type { LxSongInfo, MusicPlatform, MusicQuality } from './types';

interface SourceConfig {
  sources?: Record<string, unknown>;
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
}

let nextDispatchId = 1;

function envNameFor(sourceId: string): string {
  return `starlight_lx_${sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
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

  private constructor(
    private readonly envName: string,
    private readonly config: SourceConfig,
  ) {}

  static async create(sourceId: string, script: string): Promise<SourceRuntime | null> {
    const envName = envNameFor(sourceId);

    try {
      await songloft.jsenv.create(envName, LX_SHIM);
      const initResult = await songloft.jsenv.executeWait(envName, script, 30000, ['inited']) as RuntimeResult;
      if (initResult.error) {
        await destroyEnv(envName);
        throw new StarlightError('SOURCE_RUNTIME_FAILED', String(initResult.error), false);
      }

      const initEvent = findEvent(initResult.events, 'inited');
      if (!initEvent) {
        await destroyEnv(envName);
        throw new StarlightError('SOURCE_IMPORT_INVALID', '音源未调用 lx.send("inited")', false);
      }

      return new SourceRuntime(envName, parseEventData(initEvent.data) as SourceConfig);
    } catch (error) {
      if (error instanceof StarlightError) {
        throw error;
      }

      await destroyEnv(envName);
      throw new StarlightError('SOURCE_RUNTIME_FAILED', String(error), false);
    }
  }

  supportsPlatform(platform: MusicPlatform | string): boolean {
    return Boolean(this.config.sources?.[platform]);
  }

  async getMusicUrl(
    platform: MusicPlatform | string,
    quality: MusicQuality | string,
    songInfo: LxSongInfo,
  ): Promise<string | null> {
    const dispatchId = `musicUrl_${nextDispatchId++}`;
    const payload = { platform, quality, songInfo };
    const code = `globalThis.lx._dispatch(${JSON.stringify(dispatchId)}, "musicUrl", ${JSON.stringify(payload)});`;

    try {
      const dispatchResult = await songloft.jsenv.executeWait(
        this.envName,
        code,
        30000,
        ['dispatchResult', 'dispatchError'],
      ) as RuntimeResult;
      if (dispatchResult.error) {
        return null;
      }

      const resultEvent = this.findDispatchEvent(dispatchResult.events, 'dispatchResult', dispatchId);
      if (!resultEvent) {
        return null;
      }

      const data = parseEventData(resultEvent.data) as DispatchEnvelope;
      return stringUrl(data.result);
    } catch {
      return null;
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    await songloft.jsenv.destroy(this.envName);
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

async function destroyEnv(envName: string): Promise<void> {
  try {
    await songloft.jsenv.destroy(envName);
  } catch {
    // Preserve the original source runtime failure.
  }
}
