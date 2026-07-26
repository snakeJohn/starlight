import { StarlightError } from '../system/errors';
import { md5 } from '../utils/crypto';
import {
  normalizeOnlineSourceUrl,
  type OnlineSourceFetcher,
  redactOnlineSourceUrl,
} from './online_source_fetcher';
import type {
  OnlineSourceEntrySnapshot,
  OnlineSourceUpsertResult,
  SourceManager,
} from './source_manager';
import type { RuntimeManager } from './runtime_manager';
import type { MusicSourceMeta } from './types';

export type OnlineSourceEnableMode = 'playback' | 'download' | 'both';

export interface OnlineSourceImportResult {
  operation: 'imported' | 'updated';
  source: MusicSourceMeta;
  playbackEnabled: boolean;
  downloadEnabled: boolean;
  contentChanged: boolean;
}

export interface OnlineSourceImportServiceOptions {
  fetcher: OnlineSourceFetcher;
  playbackSources: SourceManager;
  downloadSources: SourceManager;
  playbackRuntimes: RuntimeManager;
  downloadRuntimes: RuntimeManager;
}

function enableFlags(mode: OnlineSourceEnableMode): { playbackEnabled: boolean; downloadEnabled: boolean } {
  switch (mode) {
    case 'playback':
      return { playbackEnabled: true, downloadEnabled: false };
    case 'download':
      return { playbackEnabled: false, downloadEnabled: true };
    case 'both':
      return { playbackEnabled: true, downloadEnabled: true };
    default:
      throw new StarlightError('BAD_REQUEST', 'enable_mode must be playback, download, or both');
  }
}

function stableIdForSourceUrl(sourceUrl: string): string {
  return `online-${md5(sourceUrl).slice(0, 16)}`;
}

/**
 * Downloads once and upserts the same script into playback + download stores.
 * Same normalized URL imports are serialized; store writes still use each
 * SourceManager mutation queue. Rollback is per online URL/entry only.
 */
export class OnlineSourceImportService {
  private readonly fetcher: OnlineSourceFetcher;
  private readonly playbackSources: SourceManager;
  private readonly downloadSources: SourceManager;
  private readonly playbackRuntimes: RuntimeManager;
  private readonly downloadRuntimes: RuntimeManager;
  /** Per normalized URL promise chain for serializing concurrent imports. */
  private readonly urlLocks = new Map<string, Promise<unknown>>();

  constructor(options: OnlineSourceImportServiceOptions) {
    this.fetcher = options.fetcher;
    this.playbackSources = options.playbackSources;
    this.downloadSources = options.downloadSources;
    this.playbackRuntimes = options.playbackRuntimes;
    this.downloadRuntimes = options.downloadRuntimes;
  }

  async importUrl(url: string, enableMode: OnlineSourceEnableMode): Promise<OnlineSourceImportResult> {
    const flags = enableFlags(enableMode);
    // Normalize early so fragment-only differences share one lock key.
    const { sourceUrl } = normalizeOnlineSourceUrl(url);
    return this.withUrlLock(sourceUrl, () => this.importUrlUnlocked(url, flags));
  }

  private async withUrlLock<T>(sourceUrl: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.urlLocks.get(sourceUrl) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => gate, () => gate);
    this.urlLocks.set(sourceUrl, chain);

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.urlLocks.get(sourceUrl) === chain) {
        this.urlLocks.delete(sourceUrl);
      }
    }
  }

  private async importUrlUnlocked(
    url: string,
    flags: { playbackEnabled: boolean; downloadEnabled: boolean },
  ): Promise<OnlineSourceImportResult> {
    const fetched = await this.fetcher.fetch(url);
    const stableId = stableIdForSourceUrl(fetched.sourceUrl);

    // Capture only this online entry so rollback cannot wipe concurrent unrelated edits.
    const playbackSnapshot = await this.playbackSources.captureOnlineEntryBySourceUrl(fetched.sourceUrl);
    const downloadSnapshot = await this.downloadSources.captureOnlineEntryBySourceUrl(fetched.sourceUrl);

    let playbackResult: OnlineSourceUpsertResult | undefined;
    let downloadResult: OnlineSourceUpsertResult | undefined;

    try {
      playbackResult = await this.playbackSources.upsertOnlineSource({
        stableId,
        filename: fetched.filename,
        script: fetched.content,
        sourceUrl: fetched.sourceUrl,
        resolvedUrl: fetched.resolvedUrl,
        contentHash: fetched.contentHash,
        enabled: flags.playbackEnabled,
      });

      downloadResult = await this.downloadSources.upsertOnlineSource({
        stableId,
        filename: fetched.filename,
        script: fetched.content,
        sourceUrl: fetched.sourceUrl,
        resolvedUrl: fetched.resolvedUrl,
        contentHash: fetched.contentHash,
        enabled: flags.downloadEnabled,
      });
    } catch (error) {
      await this.rollbackEntries(
        fetched.sourceUrl,
        stableId,
        playbackSnapshot,
        downloadSnapshot,
        error,
      );
      throw new StarlightError(
        'SOURCE_ONLINE_IMPORT_FAILED',
        '导入失败，已恢复原有音源',
        false,
        {
          url: redactOnlineSourceUrl(fetched.sourceUrl),
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    try {
      await Promise.all([
        this.playbackRuntimes.loadEnabledSources(),
        this.downloadRuntimes.loadEnabledSources(),
      ]);
    } catch (error) {
      // Storage already committed; still report success of storage, but surface reload issues in logs only.
      songloft.log.warn(
        `[OnlineSourceImport] runtime reload failed for ${redactOnlineSourceUrl(fetched.sourceUrl)}: ${String(error)}`,
      );
    }

    const operation =
      playbackResult.operation === 'updated' || downloadResult.operation === 'updated'
        ? 'updated'
        : 'imported';
    const contentChanged = playbackResult.contentChanged || downloadResult.contentChanged;

    return {
      operation,
      source: playbackResult.source,
      playbackEnabled: flags.playbackEnabled,
      downloadEnabled: flags.downloadEnabled,
      contentChanged,
    };
  }

  private async rollbackEntries(
    sourceUrl: string,
    stableId: string,
    playbackSnapshot: OnlineSourceEntrySnapshot,
    downloadSnapshot: OnlineSourceEntrySnapshot,
    originalError: unknown,
  ): Promise<void> {
    const errors: string[] = [];
    try {
      await this.playbackSources.restoreOnlineEntry(sourceUrl, stableId, playbackSnapshot);
    } catch (error) {
      errors.push(`playback: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.downloadSources.restoreOnlineEntry(sourceUrl, stableId, downloadSnapshot);
    } catch (error) {
      errors.push(`download: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (errors.length > 0) {
      songloft.log.error(
        `[OnlineSourceImport] entry rollback failed after ${originalError instanceof Error ? originalError.message : String(originalError)}: ${errors.join('; ')}`,
      );
      throw new StarlightError(
        'INTERNAL_ERROR',
        '导入失败，且无法完整恢复原有音源',
        false,
        { rollbackErrors: errors },
      );
    }
  }
}
