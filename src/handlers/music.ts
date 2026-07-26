import { parseQuery } from '@songloft/plugin-sdk';
import type { HTTPRequest, Router } from '@songloft/plugin-sdk';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { paginationInt, requireId, stringField } from '../system/fields';
import { runApi, runRawJson } from '../system/response';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatformProvider } from '../music/platforms/types';
import { resolveMusicLyric } from '../music/platforms/lyrics';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SourceManager } from '../music/source_manager';
import type { LxSongInfo, MusicPlatform } from '../music/types';
import { registerSourceCrudRoutes } from './sources_crud';

interface SearchBody {
  keyword?: unknown;
  source_id?: unknown;
  quality?: unknown;
  page?: unknown;
  page_size?: unknown;
}

interface UrlBody {
  source_data?: {
    platform?: unknown;
    quality?: unknown;
    songInfo?: unknown;
    starlight?: unknown;
  };
}

interface LyricBody {
  source_data?: {
    platform?: unknown;
    songInfo?: unknown;
  };
}

interface MusicHandlerOptions {
  downloadRuntimes?: RuntimeManager;
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

function musicUrlResolveFailureMessage(
  operation: 'playback' | 'download',
  attemptedCount: number,
  lastFailure: string | null,
): string {
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

export function registerMusicHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
  platforms: PlatformRegistry,
  options: MusicHandlerOptions = {},
): void {
  registerSourceCrudRoutes(router, {
    prefix: '/api/music/sources',
    sources,
    runtimes,
    runtimeLabel: 'music',
  });

  router.get('/api/music/platforms', async () => runApi(() => platforms.all()));

  router.post('/api/music/search', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<SearchBody>(req);
      const provider = providerFor(platforms, body.source_id);
      const quality = stringField(body.quality);
      const result = await provider.search(requireKeyword(body.keyword), page(body.page), pageSize(body.page_size));
      return applyRequestedQuality(result, quality);
    }));

  router.post('/api/music/url', async (req) =>
    runRawJson(async () => {
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
    runApi(() => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      return provider.recommendedSongLists(page(params.page), pageSize(params.page_size));
    }));

  router.post('/api/music/songlist/search', async (req) =>
    runApi(() => {
      const body = parseJsonBody<SearchBody>(req);
      const provider = providerFor(platforms, body.source_id);
      return provider.songListSearch(requireKeyword(body.keyword), page(body.page), pageSize(body.page_size));
    }));

  router.get('/api/music/songlist/detail', async (req) =>
    runApi(async () => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      const quality = stringField(params.quality);
      const result = await provider.songListDetail(requireId(params.id), page(params.page), pageSize(params.page_size));
      return applyRequestedQuality(result, quality);
    }));

  router.get('/api/music/leaderboard/boards', async (req) =>
    runApi(() => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      return provider.leaderboardBoards();
    }));

  router.get('/api/music/leaderboard/list', async (req) =>
    runApi(async () => {
      const params = query(req);
      const provider = providerFor(platforms, params.source_id);
      const quality = stringField(params.quality);
      const result = await provider.leaderboardList(requireId(params.id), page(params.page), pageSize(params.page_size));
      return applyRequestedQuality(result, quality);
    }));

  router.post('/api/music/lyric', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<LyricBody>(req);
      const sourceData = body.source_data;
      if (!sourceData || typeof sourceData !== 'object') {
        throw new StarlightError('BAD_REQUEST', 'source_data is required');
      }
      const platform = stringField(sourceData.platform);
      if (!platform) {
        throw new StarlightError('BAD_REQUEST', 'source_data.platform is required');
      }
      if (!platforms.get(platform)) {
        throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
      }
      const songInfo = sourceData.songInfo;
      if (!songInfo || typeof songInfo !== 'object') {
        throw new StarlightError('BAD_REQUEST', 'source_data.songInfo is required');
      }
      return resolveMusicLyric(platform as MusicPlatform, songInfo as LxSongInfo);
    }));
}
