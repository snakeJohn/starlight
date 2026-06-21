import type { SourceManager } from './source_manager';
import { SourceRuntime } from './runtime';
import type { LxSongInfo, MusicPlatform, MusicQuality } from './types';

export class RuntimeManager {
  private runtimes: SourceRuntime[] = [];

  constructor(private readonly sourceManager: SourceManager) {}

  async loadEnabledSources(): Promise<void> {
    await this.close();

    for (const source of this.sourceManager.listSources()) {
      if (!source.enabled) {
        continue;
      }

      const script = await this.sourceManager.getScript(source.id);
      if (script === null) {
        continue;
      }

      try {
        const runtime = await SourceRuntime.create(source.id, script);
        if (runtime) {
          this.runtimes.push(runtime);
        }
      } catch (error) {
        songloft.log.warn(`Failed to load music source ${source.id}: ${String(error)}`);
      }
    }
  }

  async getMusicUrl(
    platform: MusicPlatform | string,
    quality: MusicQuality | string,
    songInfo: LxSongInfo,
  ): Promise<string | null> {
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
    const runtimes = this.runtimes;
    this.runtimes = [];

    for (const runtime of runtimes) {
      try {
        await runtime.destroy();
      } catch (error) {
        songloft.log.warn(`Failed to close music source runtime: ${String(error)}`);
      }
    }
  }
}
