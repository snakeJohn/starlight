import type { SourceManager } from './source_manager';
import { SourceRuntime } from './runtime';
import type { LxSongInfo, MusicPlatform, MusicQuality, MusicSourceMeta } from './types';
import { sourceDiagnostics, type SourceDiagnosticOperation } from '../diagnostics/source_logs';

export interface MusicUrlResolutionAttempt {
  attemptedSources: number;
  lastFailure: string | null;
}

export interface RuntimeManagerOptions {
  musicUrlTimeoutMs?: number;
  runtimeNamespace?: string;
}

export interface MusicUrlResolveOptions {
  operation?: SourceDiagnosticOperation;
  title?: string;
  artist?: string;
}

const DEFAULT_MUSIC_URL_TIMEOUT_MS = 8000;

export class RuntimeManager {
  private runtimes: SourceRuntime[] = [];
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private lifecycleBusy = false;
  private lastMusicUrlAttempt: MusicUrlResolutionAttempt = { attemptedSources: 0, lastFailure: null };
  private readonly musicUrlTimeoutMs: number;
  private readonly runtimeSources = new WeakMap<SourceRuntime, MusicSourceMeta>();
  private readonly runtimeNamespace: string;

  constructor(private readonly sourceManager: SourceManager, options: RuntimeManagerOptions = {}) {
    const timeout = Number(options.musicUrlTimeoutMs);
    this.musicUrlTimeoutMs = Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_MUSIC_URL_TIMEOUT_MS;
    this.runtimeNamespace = typeof options.runtimeNamespace === 'string' ? options.runtimeNamespace.trim() : '';
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

          const runtime = await SourceRuntime.create(source.id, script, {
            runtimeNamespace: this.runtimeNamespace,
          });
          this.runtimeSources.set(runtime, source);
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
    options: MusicUrlResolveOptions = {},
  ): Promise<string | null> {
    if (this.lifecycleBusy) {
      await this.lifecycleQueue;
    }

    const normalizedSongInfo = normalizeRuntimeSongInfo(platform, songInfo);
    if (!hasResolvableSongId(normalizedSongInfo)) {
      const lastFailure = '歌曲缺少可解析 ID';
      this.lastMusicUrlAttempt = { attemptedSources: 0, lastFailure };
      sourceDiagnostics.record({
        operation: options.operation || 'playback',
        stage: 'resolve',
        status: 'failed',
        sourceId: '',
        sourceName: 'Starlight',
        platform: String(platform),
        quality: String(quality),
        title: options.title || normalizedSongInfo.name,
        artist: options.artist || normalizedSongInfo.singer,
        message: lastFailure,
      });
      return null;
    }

    let attemptedSources = 0;
    let lastFailure: string | null = null;

    for (const runtime of this.runtimes) {
      const source = this.runtimeSources.get(runtime);
      try {
        if (!runtime.supportsPlatform(platform)) {
          continue;
        }

        attemptedSources += 1;
        const startedAt = Date.now();
        const url = await withTimeout(
          runtime.getMusicUrl(platform, quality, normalizedSongInfo),
          this.musicUrlTimeoutMs,
          `music URL source timed out after ${this.musicUrlTimeoutMs}ms`,
        );
        if (url) {
          sourceDiagnostics.record({
            operation: options.operation || 'playback',
            stage: 'resolve',
            status: 'success',
            sourceId: source?.id || '',
            sourceName: source?.name || source?.id || '',
            platform: String(platform),
            quality: String(quality),
            title: options.title || normalizedSongInfo.name,
            artist: options.artist || normalizedSongInfo.singer,
            durationMs: Date.now() - startedAt,
            message: '解析成功',
          });
          this.lastMusicUrlAttempt = { attemptedSources, lastFailure };
          return url;
        }
        lastFailure = runtime.getLastMusicUrlFailure?.() || '音源未返回 URL';
        sourceDiagnostics.record({
          operation: options.operation || 'playback',
          stage: 'resolve',
          status: 'failed',
          sourceId: source?.id || '',
          sourceName: source?.name || source?.id || '',
          platform: String(platform),
          quality: String(quality),
          title: options.title || normalizedSongInfo.name,
          artist: options.artist || normalizedSongInfo.singer,
          durationMs: Date.now() - startedAt,
          message: lastFailure,
        });
      } catch (error) {
        lastFailure = errorMessage(error);
        sourceDiagnostics.record({
          operation: options.operation || 'playback',
          stage: 'resolve',
          status: 'failed',
          sourceId: source?.id || '',
          sourceName: source?.name || source?.id || '',
          platform: String(platform),
          quality: String(quality),
          title: options.title || normalizedSongInfo.name,
          artist: options.artist || normalizedSongInfo.singer,
          message: lastFailure,
        });
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

function normalizeRuntimeSongInfo(platform: MusicPlatform | string, songInfo: LxSongInfo): LxSongInfo {
  const songmid = stringValue(songInfo.songmid || songInfo.musicId || songInfo.copyrightId || songInfo.strMediaMid);
  return {
    ...songInfo,
    source: songInfo.source || String(platform),
    songmid,
  };
}

function hasResolvableSongId(songInfo: LxSongInfo): boolean {
  return Boolean(
    stringValue(songInfo.hash)
    || stringValue(songInfo.songmid)
    || stringValue(songInfo.musicId)
    || stringValue(songInfo.copyrightId)
    || stringValue(songInfo.strMediaMid),
  );
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
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
