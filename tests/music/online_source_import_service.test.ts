import { describe, expect, test, vi } from 'vitest';
import type { FetchedOnlineSource, OnlineSourceFetcher } from '../../src/music/online_source_fetcher';
import { OnlineSourceImportService } from '../../src/music/online_source_import_service';
import type {
  OnlineSourceUpsertInput,
  OnlineSourceUpsertResult,
  SourceManager,
} from '../../src/music/source_manager';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { MusicSourceMeta } from '../../src/music/types';
import { StarlightError } from '../../src/system/errors';

const fetched: FetchedOnlineSource = {
  sourceUrl: 'https://example.test/source.js',
  resolvedUrl: 'https://cdn.test/source.js',
  filename: 'source.js',
  content: "lx.send('inited', { status: true });",
  contentHash: 'hash-1',
};

function sourceMeta(overrides: Partial<MusicSourceMeta> = {}): MusicSourceMeta {
  return {
    id: 'online-id',
    name: 'Online Source',
    version: '1.0.0',
    description: '',
    author: '',
    homepage: '',
    filename: 'source.js',
    importedAt: '2026-07-24T00:00:00.000Z',
    enabled: false,
    supportedPlatforms: [],
    sourceUrl: fetched.sourceUrl,
    resolvedUrl: fetched.resolvedUrl,
    contentHash: fetched.contentHash,
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

function harness(options: { failDownload?: boolean; failPlayback?: boolean; slowFetchMs?: number } = {}) {
  const fetcher = {
    fetch: vi.fn(async () => {
      if (options.slowFetchMs) {
        await new Promise((resolve) => setTimeout(resolve, options.slowFetchMs));
      }
      return { ...fetched };
    }),
  } as unknown as OnlineSourceFetcher;

  const playbackCalls: OnlineSourceUpsertInput[] = [];
  const downloadCalls: OnlineSourceUpsertInput[] = [];

  const playback = {
    captureOnlineEntryBySourceUrl: vi.fn(async () => ({ present: false as const })),
    restoreOnlineEntry: vi.fn(async () => {}),
    upsertOnlineSource: vi.fn(async (input: OnlineSourceUpsertInput): Promise<OnlineSourceUpsertResult> => {
      playbackCalls.push(input);
      if (options.failPlayback) {
        throw new Error('playback upsert failed');
      }
      return {
        operation: 'imported',
        source: sourceMeta({ enabled: input.enabled }),
        contentChanged: true,
      };
    }),
  } as unknown as SourceManager;

  const download = {
    captureOnlineEntryBySourceUrl: vi.fn(async () => ({ present: false as const })),
    restoreOnlineEntry: vi.fn(async () => {}),
    upsertOnlineSource: vi.fn(async (input: OnlineSourceUpsertInput): Promise<OnlineSourceUpsertResult> => {
      downloadCalls.push(input);
      if (options.failDownload) {
        throw new Error('download upsert failed');
      }
      return {
        operation: 'imported',
        source: sourceMeta({ enabled: input.enabled }),
        contentChanged: true,
      };
    }),
  } as unknown as SourceManager;

  const playbackRuntime = {
    loadEnabledSources: vi.fn(async () => {}),
  } as unknown as RuntimeManager;
  const downloadRuntime = {
    loadEnabledSources: vi.fn(async () => {}),
  } as unknown as RuntimeManager;

  const service = new OnlineSourceImportService({
    fetcher,
    playbackSources: playback,
    downloadSources: download,
    playbackRuntimes: playbackRuntime,
    downloadRuntimes: downloadRuntime,
  });

  return {
    service,
    fetcher,
    playback,
    download,
    playbackRuntime,
    downloadRuntime,
    playbackCalls,
    downloadCalls,
  };
}

describe('OnlineSourceImportService', () => {
  test.each([
    ['playback', true, false],
    ['download', false, true],
    ['both', true, true],
  ] as const)('applies %s enablement to both stores', async (mode, playbackEnabled, downloadEnabled) => {
    const h = harness();
    const result = await h.service.importUrl('https://example.test/source.js', mode);
    expect(result).toMatchObject({ playbackEnabled, downloadEnabled, operation: 'imported' });
    expect(h.playback.upsertOnlineSource).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: playbackEnabled, sourceUrl: fetched.sourceUrl }),
    );
    expect(h.download.upsertOnlineSource).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: downloadEnabled, sourceUrl: fetched.sourceUrl }),
    );
    expect(h.fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(h.playbackRuntime.loadEnabledSources).toHaveBeenCalledTimes(1);
    expect(h.downloadRuntime.loadEnabledSources).toHaveBeenCalledTimes(1);
  });

  test('restores only online entries when download upsert fails', async () => {
    const h = harness({ failDownload: true });
    await expect(h.service.importUrl('https://example.test/source.js', 'both')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_IMPORT_FAILED',
    });
    expect(h.playback.restoreOnlineEntry).toHaveBeenCalledTimes(1);
    expect(h.download.restoreOnlineEntry).toHaveBeenCalledTimes(1);
    expect(h.playback.restoreOnlineEntry).toHaveBeenCalledWith(
      fetched.sourceUrl,
      expect.stringMatching(/^online-/),
      { present: false },
    );
    expect(h.playbackRuntime.loadEnabledSources).not.toHaveBeenCalled();
  });

  test('restores only online entries when playback upsert fails before download write', async () => {
    const h = harness({ failPlayback: true });
    await expect(h.service.importUrl('https://example.test/source.js', 'both')).rejects.toMatchObject({
      code: 'SOURCE_ONLINE_IMPORT_FAILED',
    });
    expect(h.download.upsertOnlineSource).not.toHaveBeenCalled();
    expect(h.playback.restoreOnlineEntry).toHaveBeenCalledTimes(1);
    expect(h.download.restoreOnlineEntry).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent imports of the same normalized URL', async () => {
    const h = harness({ slowFetchMs: 20 });
    await Promise.all([
      h.service.importUrl('https://example.test/source.js#x', 'playback'),
      h.service.importUrl('https://example.test/source.js#y', 'download'),
    ]);
    expect(h.fetcher.fetch).toHaveBeenCalledTimes(2);
    expect(h.playback.upsertOnlineSource).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid enable modes', async () => {
    const h = harness();
    await expect(h.service.importUrl('https://example.test/source.js', 'invalid' as 'both')).rejects.toBeInstanceOf(
      StarlightError,
    );
    expect(h.fetcher.fetch).not.toHaveBeenCalled();
  });

  test('uses identical stableId/script/hash for both stores', async () => {
    const h = harness();
    await h.service.importUrl('https://example.test/source.js', 'both');
    const playbackInput = h.playbackCalls[0];
    const downloadInput = h.downloadCalls[0];
    expect(playbackInput.stableId).toBe(downloadInput.stableId);
    expect(playbackInput.script).toBe(downloadInput.script);
    expect(playbackInput.contentHash).toBe(downloadInput.contentHash);
    expect(playbackInput.sourceUrl).toBe(downloadInput.sourceUrl);
  });
});
