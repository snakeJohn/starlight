import type { SourceManager } from './source_manager';
import { SourceRuntime } from './runtime';
import type { LxSongInfo, MusicPlatform, MusicQuality } from './types';

export class RuntimeManager {
  private runtimes: SourceRuntime[] = [];
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private lifecycleBusy = false;

  constructor(private readonly sourceManager: SourceManager) {}

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

    for (const runtime of this.runtimes) {
      if (!runtime.supportsPlatform(platform)) {
        continue;
      }

      const url = await runtime.getMusicUrl(platform, quality, songInfo);
      if (url) {
        return url;
      }
    }

    return null;
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
