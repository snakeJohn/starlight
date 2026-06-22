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

  async importSongs(songs: SearchResultSong[]): Promise<{ total: number; payloads: RemoteSongPayload[] }> {
    if (songs.length === 0) {
      return { total: 0, payloads: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    for (const song of songs) {
      const url = await this.previewUrl(song);
      payloads.push(toRemoteSong(song, url));
    }

    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const imported = await postRemoteSongs(host, token, payloads);
    if (!imported.ok) {
      if (!isDuplicateRemoteSongError(imported.body)) {
        throw remoteImportError(imported.status, imported.body);
      }

      for (const payload of payloads) {
        const single = await postRemoteSongs(host, token, [payload]);
        if (!single.ok && !isDuplicateRemoteSongError(single.body)) {
          throw remoteImportError(single.status, single.body);
        }
      }
    }

    return { total: payloads.length, payloads };
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
    const url = await this.previewUrl(song);
    const played = this.playlistManagerMap
      ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone([toPlayerSong(song, url)], 0, 'single')
      : await this.minaService.playURL(accountId, deviceId, url);
    if (!played) {
      throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    }

    return { url };
  }

  async playResolvedOnSpeaker(accountId: string, deviceId: string, title: string, artist = ''): Promise<{ url: string }> {
    const song = await this.resolvePlayableSong(title, artist);
    if (!song) {
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', `未找到可用音源：${title}${artist ? ` - ${artist}` : ''}`, true);
    }

    const played = this.playlistManagerMap
      ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone([song], 0, 'single')
      : await this.minaService.playURL(accountId, deviceId, song.url);
    if (!played) {
      throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    }

    return { url: song.url };
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
    const keyword = [title, artist].map((item) => item.trim()).filter(Boolean).join(' ');
    if (!keyword) {
      return null;
    }

    for (const platform of this.platforms.all()) {
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
            return { song: candidate.song, url };
          } catch (error) {
            songloft.log.warn(`[BridgeService] Resolved search hit is not playable on ${platform.id}: ${sanitizeProviderError(error)}`);
          }
        }
      } catch (error) {
        songloft.log.warn(`[BridgeService] Resolve search provider ${platform.id} failed: ${sanitizeProviderError(error)}`);
      }
    }

    return null;
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

async function postRemoteSongs(host: string, token: string, payloads: RemoteSongPayload[]): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetch(`${host}/api/v1/songs/remote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payloads),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? '' : await safeResponseText(response),
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
