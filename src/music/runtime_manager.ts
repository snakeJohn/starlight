import type { SourceManager } from './source_manager';
import { SourceRuntime } from './runtime';
import type { LxSongInfo, MusicPlatform, MusicQuality } from './types';

export interface MusicUrlResolutionAttempt {
  attemptedSources: number;
  lastFailure: string | null;
}

export interface RuntimeManagerOptions {
  musicUrlTimeoutMs?: number;
}

const DEFAULT_MUSIC_URL_TIMEOUT_MS = 8000;

export class RuntimeManager {
  private runtimes: SourceRuntime[] = [];
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private lifecycleBusy = false;
  private lastMusicUrlAttempt: MusicUrlResolutionAttempt = { attemptedSources: 0, lastFailure: null };
  private readonly musicUrlTimeoutMs: number;

  constructor(private readonly sourceManager: SourceManager, options: RuntimeManagerOptions = {}) {
    const timeout = Number(options.musicUrlTimeoutMs);
    this.musicUrlTimeoutMs = Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_MUSIC_URL_TIMEOUT_MS;
  }

  async loadEnabledSources(): Promise<void> {
    return this.enqueueLifecycle(() => this.reloadEnabledSources());
  }

  private async reloadEnabledSources(): Promise<void> {
    await this.closeLoadedRuntimes();

    const nextRuntimes: SourceRuntime[] = [];
    try {
      for (const source of this.sourceManager.listSources()) {
        if (!source.enabled) {
          continue;
        }

        try {
          const script = await this.sourceManager.getScript(source.id);
          if (script === null) {
            continue;
          }

          const runtime = await SourceRuntime.create(source.id, script);
          nextRuntimes.push(runtime);
        } catch (error) {
          songloft.log.warn(`Failed to load music source ${source.id}: ${String(error)}`);
        }
      }

      this.runtimes = nextRuntimes;
    } catch (error) {
      await this.destroyRuntimes(nextRuntimes);
      throw error;
    }
  }

  async getMusicUrl(
    platform: MusicPlatform | string,
    quality: MusicQuality | string,
    songInfo: LxSongInfo,
  ): Promise<string | null> {
    if (this.lifecycleBusy) {
      await this.lifecycleQueue;
    }

    let attemptedSources = 0;
    let lastFailure: string | null = null;

    for (const runtime of this.runtimes) {
      try {
        if (!runtime.supportsPlatform(platform)) {
          continue;
        }

        attemptedSources += 1;
        const url = await withTimeout(
          runtime.getMusicUrl(platform, quality, songInfo),
          this.musicUrlTimeoutMs,
          `music URL source timed out after ${this.musicUrlTimeoutMs}ms`,
        );
        if (url) {
          this.lastMusicUrlAttempt = { attemptedSources, lastFailure };
          return url;
        }
      } catch (error) {
        lastFailure = errorMessage(error);
        songloft.log.warn(`Failed to resolve music URL from source runtime: ${lastFailure}`);
      }
    }

    this.lastMusicUrlAttempt = { attemptedSources, lastFailure };
    return null;
  }

  getLastMusicUrlAttempt(): MusicUrlResolutionAttempt {
    return { ...this.lastMusicUrlAttempt };
  }

  count(): number {
    return this.runtimes.length;
  }

  async close(): Promise<void> {
    await this.enqueueLifecycle(() => this.closeLoadedRuntimes());
  }

  private async enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    const previous = this.lifecycleQueue;
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lifecycleQueue = current;
    this.lifecycleBusy = true;

    await previous;
    try {
      await task();
    } finally {
      release();
      if (this.lifecycleQueue === current) {
        this.lifecycleBusy = false;
      }
    }
  }

  private async closeLoadedRuntimes(): Promise<void> {
    const runtimes = this.runtimes;
    this.runtimes = [];

    await this.destroyRuntimes(runtimes);
  }

  private async destroyRuntimes(runtimes: SourceRuntime[]): Promise<void> {
    const destroys = runtimes.map(async (runtime) => {
      try {
        await runtime.destroy();
      } catch (error) {
        songloft.log.warn(`Failed to close music source runtime: ${String(error)}`);
      }
    });

    await Promise.all(destroys);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}
