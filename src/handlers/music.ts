import { parseQuery } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, Router } from '@songloft/plugin-sdk';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatformProvider } from '../music/platforms/types';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SourceImportFile, SourceManager } from '../music/source_manager';
import type { LxSongInfo } from '../music/types';

interface SearchBody {
  keyword?: unknown;
  source_id?: unknown;
  quality?: unknown;
  page?: unknown;
  page_size?: unknown;
}

interface SourceImportBody {
  filename?: unknown;
  content?: unknown;
  files?: unknown;
}

interface SourceToggleBody {
  id?: unknown;
  enabled?: unknown;
}

interface SourceBatchToggleBody {
  ids?: unknown;
  enabled?: unknown;
}

interface UrlBody {
  source_data?: {
    platform?: unknown;
    quality?: unknown;
    songInfo?: unknown;
    starlight?: unknown;
  };
}

interface MusicHandlerOptions {
  downloadRuntimes?: RuntimeManager;
}

function statusFor(error: unknown): number {
  if (error instanceof StarlightError) {
    if (error.code === 'BAD_REQUEST' || error.code === 'MUSIC_PLATFORM_UNSUPPORTED') {
      return 400;
    }
    if (error.code === 'PLAY_URL_RESOLVE_FAILED') {
      return 404;
    }
  }

  return 500;
}

async function handle(fn: () => unknown | Promise<unknown>, statusCode = 200): Promise<HTTPResponse> {
  try {
    return apiOk(await fn(), statusCode);
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

async function handleRawJson(fn: () => unknown | Promise<unknown>, statusCode = 200): Promise<HTTPResponse> {
  try {
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await fn()),
    };
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolField(value: unknown): boolean {
  return value === true || value === 'true';
}

function paginationInt(value: unknown, name: 'page' | 'page_size', fallback: number, max?: number): number {
  if (value === undefined) {
    return fallback;
  }

  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric <= 0 || (max !== undefined && numeric > max)) {
    throw new StarlightError('BAD_REQUEST', `${name} must be an integer between 1 and ${max ?? 'unlimited'}`);
  }

  return numeric;
}

function page(value: unknown): number {
  return paginationInt(value, 'page', 1);
}

function pageSize(value: unknown): number {
  return paginationInt(value, 'page_size', 30, 100);
}

function query(req: HTTPRequest): Record<string, string> {
  return parseQuery(req.query || '');
}

function providerFor(platforms: PlatformRegistry, id: unknown): MusicPlatformProvider {
  const sourceId = stringField(id);
  if (!sourceId) {
    throw new StarlightError('BAD_REQUEST', 'source_id is required');
  }

  const provider = platforms.get(sourceId);
  if (!provider) {
    throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
  }

  return provider;
}

function requireKeyword(value: unknown): string {
  const keyword = stringField(value);
  if (!keyword) {
    throw new StarlightError('BAD_REQUEST', 'keyword is required');
  }

  return keyword;
}

function requireId(value: unknown, name = 'id'): string {
  const id = stringField(value);
  if (!id) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }

  return id;
}

function sourceImportFiles(value: unknown): SourceImportFile[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'files must be an array');
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new StarlightError('BAD_REQUEST', 'files entries must be objects');
    }
    const record = entry as Record<string, unknown>;
    const filename = requireId(record.filename, 'filename');
    const content = typeof record.content === 'string' ? record.content : '';
    if (!content) {
      throw new StarlightError('BAD_REQUEST', 'content is required');
    }
    return { filename, content };
  });
}

function sourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'ids must be an array');
  }
  const ids = value.map((entry) => requireId(entry));
  if (ids.length === 0) {
    throw new StarlightError('BAD_REQUEST', 'ids must not be empty');
  }
  return ids;
}

function reloadRuntimesInBackground(runtimes: RuntimeManager): void {
  runtimes.loadEnabledSources().catch((error) => {
    songloft.log.warn('Failed to reload music source runtimes: ' + String(error));
  });
}

function applyRequestedQuality<T>(result: T, quality: string): T {
  if (!quality || !result || typeof result !== 'object') {
    return result;
  }

  const record = result as Record<string, unknown>;
  const collections = [record.list, record.songs, Array.isArray(result) ? result : null];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!item || typeof item !== 'object') continue;
      const song = item as Record<string, unknown>;
      const sourceData = song.source_data;
      if (!sourceData || typeof sourceData !== 'object') continue;
      song.source_data = {
        ...(sourceData as Record<string, unknown>),
        quality,
      };
    }
  }

  return result;
}

export function registerMusicHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
  platforms: PlatformRegistry,
  options: MusicHandlerOptions = {},
): void {
  router.get('/api/music/platforms', async () => handle(() => platforms.all()));

  router.get('/api/music/sources', async () => handle(() => sources.listSources()));

  router.post('/api/music/sources/import', async (req) =>
    handle(() => {
      const body = parseJsonBody<SourceImportBody>(req);
      if (body.files !== undefined) {
        return sources.importManyFromJS(sourceImportFiles(body.files));
      }

      const filename = requireId(body.filename, 'filename');
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content) {
        throw new StarlightError('BAD_REQUEST', 'content is required');
      }

      return sources.importFromJS(filename, content);
    }, 201));

  router.post('/api/music/sources/toggle', async (req) =>
    handle(async () => {
      const body = parseJsonBody<SourceToggleBody>(req);
      const id = requireId(body.id);
      const enabled = boolField(body.enabled);
      await sources.setEnabled(id, enabled);
      reloadRuntimesInBackground(runtimes);

      return sources.listSources().find((source) => source.id === id) || { id, enabled };
    }));

  router.post('/api/music/sources/batch-toggle', async (req) =>
    handle(async () => {
      const body = parseJsonBody<SourceBatchToggleBody>(req);
      const ids = sourceIds(body.ids);
      const enabled = boolField(body.enabled);
      for (const id of ids) {
        await sources.setEnabled(id, enabled);
      }
      reloadRuntimesInBackground(runtimes);

      return { ids, enabled };
    }));

  router.delete('/api/music/sources/:id', async (_req, params) =>
    handle(async () => {
      const id = requireId(params.id);
      await sources.deleteSource(id);
      reloadRuntimesInBackground(runtimes);
      return { id };
    }));

  router.post('/api/music/search', async (req) =>
    handle(async () => {
      const body = parseJsonBody<SearchBody>(req);
      const provider = providerFor(platforms, body.source_id);
      const quality = stringField(body.quality);
      const result = await provider.search(requireKeyword(body.keyword), page(body.page), pageSize(body.page_size));
      return applyRequestedQuality(result, quality);
    }));

  router.post('/api/music/url', async (req) =>
    handleRawJson(async () => {
      const body = parseJsonBody<UrlBody>(req);
      const sourceData = body.source_data;
      if (!sourceData || typeof sourceData !== 'object' || !sourceData.songInfo) {
        throw new StarlightError('BAD_REQUEST', 'source_data is required');
      }

      const platform = stringField(sourceData.platform);
      const quality = stringField(sourceData.quality) || '320k';
      if (!platform) {
        throw new StarlightError('BAD_REQUEST', 'source_data.platform is required');
      }
      if (!platforms.get(platform)) {
        throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
      }

      const resolver = isDownloadMusicUrlSource(sourceData) && options.downloadRuntimes
        ? options.downloadRuntimes
        : runtimes;
      const operation = resolver === options.downloadRuntimes ? 'download' : 'playback';
      const songInfo = sourceData.songInfo as LxSongInfo;
      const url = await resolver.getMusicUrl(platform, quality, songInfo, {
        operation,
        title: songInfo.name,
        artist: songInfo.singer,
      });
      if (!url) {
        const attempt = typeof resolver.getLastMusicUrlAttempt === 'function'
          ? resolver.getLastMusicUrlAttempt()
          : { attemptedSources: 0, lastFailure: null };
        throw new StarlightError(
          'PLAY_URL_RESOLVE_FAILED',
          musicUrlResolveFailureMessage(operation, attempt.attemptedSources, attempt.lastFailure),
          true,
          {
            attempts: attempt.attemptedSources,
            lastFailure: attempt.lastFailure || '未找到可用音源',
          },
        );
      }

      return { url };
    }));

  router.get('/api/music/songlist/list', async (req) =>
    handle(() => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      return provider.recommendedSongLists(page(params.page), pageSize(params.page_size));
    }));

  router.post('/api/music/songlist/search', async (req) =>
    handle(() => {
      const body = parseJsonBody<SearchBody>(req);
      const provider = providerFor(platforms, body.source_id);
      return provider.songListSearch(requireKeyword(body.keyword), page(body.page), pageSize(body.page_size));
    }));

  router.get('/api/music/songlist/detail', async (req) =>
    handle(async () => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      const quality = stringField(params.quality);
      const result = await provider.songListDetail(requireId(params.id), page(params.page), pageSize(params.page_size));
      return applyRequestedQuality(
        result,
        quality,
      );
    }));

  router.get('/api/music/leaderboard/boards', async (req) =>
    handle(() => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      return provider.leaderboardBoards();
    }));

  router.get('/api/music/leaderboard/list', async (req) =>
    handle(async () => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      const quality = stringField(params.quality);
      const result = await provider.leaderboardList(requireId(params.id), page(params.page), pageSize(params.page_size));
      return applyRequestedQuality(
        result,
        quality,
      );
    }));

  router.post('/api/music/lyric', async () => handle(() => ({ lyric: '' })));
}

function musicUrlResolveFailureMessage(operation: 'playback' | 'download', attemptedCount: number, lastFailure: string | null): string {
  const label = operation === 'download' ? '下载' : '播放';
  if (attemptedCount > 0 || lastFailure) {
    return `${label}地址解析失败，已尝试 ${attemptedCount} 个${label}音源；最后失败原因：${lastFailure || '未找到可用音源'}`;
  }
  return `${label}地址解析失败`;
}

function isDownloadMusicUrlSource(sourceData: { starlight?: unknown }): boolean {
  const marker = sourceData.starlight;
  return Boolean(
    marker
    && typeof marker === 'object'
    && (marker as { purpose?: unknown }).purpose === 'download',
  );
}
