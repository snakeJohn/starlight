/// <reference types="@songloft/plugin-sdk" />

import { StarlightError } from '../system/errors';
import { PlatformRegistry } from '../music/platforms/registry';
import { RuntimeManager } from '../music/runtime_manager';
import type { SearchResultSong } from '../music/types';
import { toRemoteSong, type RemoteSongPayload } from './mapper';
import { MinaService } from '../service/service';
import type { PlayerSong, PlaylistManagerMap } from '../player/manager';

export class BridgeService {
  constructor(
    private readonly platforms: PlatformRegistry,
    private readonly runtimes: RuntimeManager,
    private readonly minaService: MinaService,
    private readonly playlistManagerMap?: PlaylistManagerMap,
  ) {}

  async previewUrl(song: SearchResultSong): Promise<string> {
    const url = await this.runtimes.getMusicUrl(
      song.source_data.platform,
      song.source_data.quality,
      song.source_data.songInfo,
    );
    if (!url) {
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', '无法解析播放 URL', true);
    }

    return url;
  }

  async importSongs(songs: SearchResultSong[]): Promise<{ total: number; payloads: RemoteSongPayload[]; songs: SongloftRemoteSong[] }> {
    if (songs.length === 0) {
      return { total: 0, payloads: [], songs: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    for (const song of songs) {
      const url = await this.previewUrl(song);
      payloads.push(toRemoteSong(song, url));
    }

    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const imported = await postRemoteSongs(host, token, payloads);
    let importedSongs = imported.songs;
    if (!imported.ok) {
      if (!isDuplicateRemoteSongError(imported.body)) {
        throw remoteImportError(imported.status, imported.body);
      }

      importedSongs = [];
      for (const payload of payloads) {
        const single = await postRemoteSongs(host, token, [payload]);
        if (!single.ok && !isDuplicateRemoteSongError(single.body)) {
          throw remoteImportError(single.status, single.body);
        }
        importedSongs.push(...single.songs);
      }
    }

    return { total: payloads.length, payloads, songs: importedSongs };
  }

  async importSongsBestEffort(songs: SearchResultSong[]): Promise<{
    total: number;
    skipped: number;
    payloads: RemoteSongPayload[];
    errors: Array<{ title: string; message: string }>;
  }> {
    if (songs.length === 0) {
      return { total: 0, skipped: 0, payloads: [], errors: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    for (const song of songs) {
      try {
        const url = await this.previewUrl(song);
        payloads.push(toRemoteSong(song, url));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ title: song.title, message });
        songloft.log.warn(`[BridgeService] Skip song import "${song.title}": ${sanitizeProviderError(error)}`);
      }
    }

    if (payloads.length === 0) {
      return { total: 0, skipped: errors.length, payloads: [], errors };
    }

    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const imported = await postRemoteSongs(host, token, payloads);
    if (!imported.ok) {
      if (!isDuplicateRemoteSongError(imported.body)) {
        errors.push({ title: 'Songloft 歌曲库', message: remoteImportError(imported.status, imported.body).message });
        songloft.log.warn(`[BridgeService] Remote song import failed: ${imported.status} ${sanitizeProviderError(imported.body)}`);
        return { total: 0, skipped: songs.length, payloads: [], errors };
      }

      const acceptedPayloads: RemoteSongPayload[] = [];
      for (const payload of payloads) {
        const single = await postRemoteSongs(host, token, [payload]);
        if (single.ok || isDuplicateRemoteSongError(single.body)) {
          acceptedPayloads.push(payload);
        } else {
          errors.push({ title: payload.title, message: remoteImportError(single.status, single.body).message });
        }
      }
      return {
        total: acceptedPayloads.length,
        skipped: songs.length - acceptedPayloads.length,
        payloads: acceptedPayloads,
        errors,
      };
    }

    return {
      total: payloads.length,
      skipped: songs.length - payloads.length,
      payloads,
      errors,
    };
  }

  async playOnSpeaker(accountId: string, deviceId: string, song: SearchResultSong): Promise<{ url: string }> {
    const attemptedSources = new Set<string>();
    const failures: string[] = [];
    const directUrl = await this.tryPlaySearchSongOnSpeaker(accountId, deviceId, song, attemptedSources, failures);
    if (directUrl) {
      return { url: directUrl };
    }

    const fallbackUrl = await this.tryPlayResolvedCandidatesOnSpeaker(accountId, deviceId, song.title, song.artist, attemptedSources, failures);
    if (!fallbackUrl) {
      throw playbackFallbackError(attemptedSources.size, failures);
    }

    return { url: fallbackUrl };
  }

  async playSonglistOnSpeaker(accountId: string, deviceId: string, songs: SearchResultSong[]): Promise<{ urls: string[] }> {
    if (songs.length === 0) {
      throw new StarlightError('BAD_REQUEST', 'songs must not be empty');
    }

    const playerSongs: PlayerSong[] = [];
    const urls: string[] = [];
    for (const song of songs) {
      const url = await this.previewUrl(song);
      playerSongs.push(toPlayerSong(song, url));
      urls.push(url);
    }

    const played = this.playlistManagerMap
      ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone(playerSongs, 0, 'order')
      : await this.minaService.playURL(accountId, deviceId, urls[0]);
    if (!played) {
      throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    }

    return { urls };
  }

  async playResolvedOnSpeaker(accountId: string, deviceId: string, title: string, artist = ''): Promise<{ url: string }> {
    const attemptedSources = new Set<string>();
    const failures: string[] = [];
    const url = await this.tryPlayResolvedCandidatesOnSpeaker(accountId, deviceId, title, artist, attemptedSources, failures);
    if (!url) {
      if (attemptedSources.size > 0 || failures.length > 0) {
        throw playbackFallbackError(attemptedSources.size, failures);
      }
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', `未找到可用音源：${title}${artist ? ` - ${artist}` : ''}`, true);
    }

    return { url };
  }

  async resolveSearchSong(title: string, artist = ''): Promise<SearchResultSong | null> {
    const resolved = await this.findPlayableSearchSong(title, artist);
    return resolved?.song ?? null;
  }

  async resolvePlayableSong(title: string, artist = ''): Promise<PlayerSong | null> {
    const resolved = await this.findPlayableSearchSong(title, artist);
    return resolved ? toPlayerSong(resolved.song, resolved.url) : null;
  }

  async externalSearch(keyword: string): Promise<SearchResultSong | null> {
    for (const platform of this.platforms.all()) {
      const provider = this.platforms.get(platform.id);
      if (!provider) {
        continue;
      }

      try {
        const result = await provider.search(keyword, 1, 5);
        const first = result.list[0];
        if (first) {
          return first;
        }
      } catch (error) {
        songloft.log.warn(`[BridgeService] External search provider ${platform.id} failed: ${sanitizeProviderError(error)}`);
      }
    }

    return null;
  }

  private async findPlayableSearchSong(title: string, artist: string): Promise<{ song: SearchResultSong; url: string } | null> {
    for await (const resolved of this.iterPlayableSearchCandidates(title, artist)) {
      return resolved;
    }

    return null;
  }

  private async tryPlayResolvedCandidatesOnSpeaker(
    accountId: string,
    deviceId: string,
    title: string,
    artist: string,
    attemptedSources: Set<string>,
    failures: string[],
  ): Promise<string | null> {
    for await (const resolved of this.iterPlayableSearchCandidates(title, artist, attemptedSources, failures)) {
      const url = await this.tryPlaySearchSongOnSpeaker(accountId, deviceId, resolved.song, attemptedSources, failures, resolved.url);
      if (url) {
        return url;
      }
    }

    return null;
  }

  private async tryPlaySearchSongOnSpeaker(
    accountId: string,
    deviceId: string,
    song: SearchResultSong,
    attemptedSources: Set<string>,
    failures: string[],
    resolvedUrl?: string,
  ): Promise<string | null> {
    attemptedSources.add(song.source_data.platform);
    try {
      const url = resolvedUrl ?? await this.previewUrl(song);
      const played = this.playlistManagerMap
        ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone([toPlayerSong(song, url)], 0, 'single')
        : await this.minaService.playURL(accountId, deviceId, url);
      if (!played) {
        failures.push('音箱播放 URL 失败');
        return null;
      }

      return url;
    } catch (error) {
      failures.push(sanitizeProviderError(error));
      return null;
    }
  }

  private async *iterPlayableSearchCandidates(
    title: string,
    artist: string,
    attemptedSources?: Set<string>,
    failures?: string[],
  ): AsyncGenerator<{ song: SearchResultSong; url: string }, void, void> {
    const keyword = [title, artist].map((item) => item.trim()).filter(Boolean).join(' ');
    if (!keyword) {
      return;
    }

    for (const platform of this.platforms.all()) {
      attemptedSources?.add(platform.id);
      const provider = this.platforms.get(platform.id);
      if (!provider) {
        continue;
      }

      try {
        const result = await provider.search(keyword, 1, 5);
        const candidates = (result.list ?? [])
          .map((song) => ({ song, score: scoreResolvedCandidate(title, artist, song) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);

        for (const candidate of candidates) {
          try {
            const url = await this.previewUrl(candidate.song);
            yield { song: candidate.song, url };
          } catch (error) {
            failures?.push(sanitizeProviderError(error));
            songloft.log.warn(`[BridgeService] Resolved search hit is not playable on ${platform.id}: ${sanitizeProviderError(error)}`);
          }
        }
      } catch (error) {
        failures?.push(sanitizeProviderError(error));
        songloft.log.warn(`[BridgeService] Resolve search provider ${platform.id} failed: ${sanitizeProviderError(error)}`);
      }
    }
  }
}

function toPlayerSong(song: SearchResultSong, url: string): PlayerSong {
  return {
    id: 0,
    type: 'remote',
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    file_path: '',
    url,
    cover_path: '',
    cover_url: song.cover_url,
    lyric_url: '',
    file_size: 0,
    format: '',
    bit_rate: 0,
    sample_rate: 0,
    is_live: false,
    cache_hash: '',
  };
}

function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function playbackFallbackError(attemptedCount: number, failures: string[]): StarlightError {
  const lastFailure = failures.length > 0 ? failures[failures.length - 1] : '未找到可用音源';
  const message = `播放失败，已尝试 ${attemptedCount} 个播放音源；最后失败原因：${lastFailure}`;
  const code = lastFailure.includes('音箱播放') ? 'DEVICE_OFFLINE' : 'PLAY_URL_RESOLVE_FAILED';
  return new StarlightError(code, message, true, { attempts: attemptedCount, lastFailure });
}

function normalizeSongText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[《》【】[\]（）()\s_\-·,，.。]/g, '');
}

function textMatches(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeSongText(expected);
  const normalizedActual = normalizeSongText(actual);
  return Boolean(
    normalizedExpected
    && normalizedActual
    && (normalizedActual === normalizedExpected
      || normalizedActual.includes(normalizedExpected)
      || normalizedExpected.includes(normalizedActual)),
  );
}

function scoreResolvedCandidate(title: string, artist: string, song: SearchResultSong): number {
  if (!textMatches(title, song.title)) {
    return 0;
  }

  let score = normalizeSongText(title) === normalizeSongText(song.title) ? 100 : 60;
  if (artist.trim()) {
    if (!textMatches(artist, song.artist)) {
      return 0;
    }
    score += normalizeSongText(artist) === normalizeSongText(song.artist) ? 40 : 20;
  }
  return score;
}

export interface SongloftRemoteSong {
  id?: number;
  type?: string;
  title?: string;
  artist?: string;
  album?: string;
  [key: string]: unknown;
}

interface RemoteImportResult {
  ok: boolean;
  status: number;
  body: string;
  songs: SongloftRemoteSong[];
  count: number;
}

async function safeResponseText(response: Response): Promise<string> {
  if (typeof response.text !== 'function') {
    return '';
  }
  try {
    return (await response.text()).trim().slice(0, 500);
  } catch {
    return '';
  }
}

async function safeResponseJson(response: Response): Promise<unknown> {
  if (typeof response.json !== 'function') {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function remoteImportSongsFromBody(body: unknown): SongloftRemoteSong[] {
  if (!body || typeof body !== 'object') {
    return [];
  }
  const songs = (body as { songs?: unknown }).songs;
  return Array.isArray(songs) ? (songs as SongloftRemoteSong[]) : [];
}

export async function postRemoteSongs(host: string, token: string, payloads: RemoteSongPayload[]): Promise<RemoteImportResult> {
  const response = await fetch(`${host}/api/v1/songs/remote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payloads),
  });
  const successBody = response.ok ? await safeResponseJson(response) : null;
  const songs = remoteImportSongsFromBody(successBody);
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? '' : await safeResponseText(response),
    songs,
    count: typeof successBody === 'object' && successBody !== null && typeof (successBody as { count?: unknown }).count === 'number'
      ? (successBody as { count: number }).count
      : songs.length,
  };
}

function remoteImportError(status: number, body: string): StarlightError {
  return new StarlightError('INTERNAL_ERROR', `导入 Songloft 歌曲失败: ${status}${body ? ` ${body}` : ''}`, true, {
    upstream: 'songloft_remote_import',
    status,
    ...(body ? { body } : {}),
  });
}

function isDuplicateRemoteSongError(body: string): boolean {
  return /UNIQUE constraint failed:\s*songs\.plugin_entry_path,\s*songs\.dedup_key/i.test(body)
    || /constraint failed.*songs\.plugin_entry_path.*songs\.dedup_key/i.test(body)
    || /2067/.test(body);
}
