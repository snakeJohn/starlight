/// <reference types="@songloft/plugin-sdk" />

import { StarlightError } from '../system/errors';
import { PlatformRegistry } from '../music/platforms/registry';
import { RuntimeManager } from '../music/runtime_manager';
import type { MusicQuality, SearchResultSong } from '../music/types';
import { resolveMusicLyric } from '../music/platforms/lyrics';
import { updateHostSongLyrics } from '../music/host_lyrics';
import { toRemoteSong, type RemoteSongPayload } from './mapper';
import { MinaService } from '../service/service';
import type { PlayerSong, PlaylistManagerMap } from '../player/manager';
import { URLBuilder } from '../player/url_builder';
import { normalizeHostBaseUrl, requireHostBaseUrl } from '../utils/http';
import {
  normalizeSongText,
  sanitizeProviderError,
  scoreResolvedCandidate,
} from '../utils/song_match';

const STARLIGHT_PLUGIN_ENTRY_PATH = 'starlight';
const EXISTING_REMOTE_SONG_LOOKUP_LIMIT = 20;

/** Highest → lowest playback quality ladder (channel-agnostic). */
export const PLAYBACK_QUALITY_LADDER: readonly MusicQuality[] = [
  'flac24bit',
  'flac',
  '320k',
  '128k',
];

const QUALITY_RANK: Record<string, number> = {
  flac24bit: 4,
  flac: 3,
  '320k': 2,
  '128k': 1,
};

/**
 * 已经解析好播放地址的歌曲。
 *
 * 音箱队列交接给浏览器、再切回音箱时会走这条路：状态接口的 queue 条目只带
 * 标题/时长/可播 URL，不带 source_data（带上会让 5 秒轮询驮着整个 songInfo，
 * 200 条队列不可接受）。这些歌本来就有宿主可播地址，不该也不必再解析一次音源。
 */
export interface ResolvedSpeakerSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  /** 已可直接推给音箱的地址 */
  playback_url: string;
  /** 宿主歌曲 ID（能从 /api/v1/songs/{id}/play 解析出来时），用于歌词端点 */
  song_id: number;
}

export type SpeakerQueueEntry = SearchResultSong | ResolvedSpeakerSong;

export function isResolvedSpeakerSong(entry: SpeakerQueueEntry): entry is ResolvedSpeakerSong {
  return typeof (entry as ResolvedSpeakerSong).playback_url === 'string'
    && (entry as ResolvedSpeakerSong).playback_url !== '';
}

export class BridgeService {
  constructor(
    private readonly platforms: PlatformRegistry,
    private readonly runtimes: RuntimeManager,
    private readonly minaService: MinaService,
    private readonly playlistManagerMap?: PlaylistManagerMap,
    private readonly downloads?: { downloadSong(song: SearchResultSong): Promise<{ song_id: number }> },
  ) {}

  /**
   * Resolve a playable URL, trying highest quality first across the ladder
   * (does not lock to the song's declared quality).
   */
  async previewUrl(song: SearchResultSong): Promise<string> {
    return (await this.resolvePlaybackTarget(song)).url;
  }

  /**
   * Playable URL plus the Songloft song id behind it (0 when the URL is a direct
   * source stream). Keeping the id is what lets the player payload carry
   * `/api/v1/songs/{id}/lyric` instead of an empty lyric reference.
   */
  private async resolvePlaybackTarget(song: SearchResultSong): Promise<{ url: string; songId: number }> {
    if (this.downloads) {
      const downloaded = await this.downloads.downloadSong(song);
      if (!downloaded.song_id) {
        throw new StarlightError('INTERNAL_ERROR', 'Songloft 下载未返回可播放歌曲 ID', true);
      }
      return { url: `/api/v1/songs/${downloaded.song_id}/play`, songId: downloaded.song_id };
    }
    const resolved = await this.resolvePlayback(song);
    return { url: resolved.url, songId: 0 };
  }

  async previewLyric(song: SearchResultSong) {
    return resolveMusicLyric(song.source_data.platform, song.source_data.songInfo);
  }

  /**
   * Resolve playback URL + the quality that actually worked.
   * Tries flac24bit → flac → 320k → 128k for the song's platform.
   */
  async resolvePlayback(song: SearchResultSong): Promise<{ url: string; quality: MusicQuality }> {
    const options = { operation: 'playback' as const, title: song.title, artist: song.artist };
    let lastAttempt: { attemptedSources: number; lastFailure: string | null } = {
      attemptedSources: 0,
      lastFailure: null,
    };

    for (const quality of qualitiesToTry(song)) {
      const url = await this.runtimes.getMusicUrl(
        song.source_data.platform,
        quality,
        song.source_data.songInfo,
        options,
      );
      if (typeof this.runtimes.getLastMusicUrlAttempt === 'function') {
        lastAttempt = this.runtimes.getLastMusicUrlAttempt();
      }
      if (url) {
        return { url, quality };
      }
    }

    throw new StarlightError(
      'PLAY_URL_RESOLVE_FAILED',
      playUrlResolveFailureMessage(lastAttempt.attemptedSources, lastAttempt.lastFailure),
      true,
      {
        attempts: lastAttempt.attemptedSources,
        lastFailure: lastAttempt.lastFailure || '未找到可用播放音源',
      },
    );
  }

  async importSongs(songs: SearchResultSong[]): Promise<{ total: number; payloads: RemoteSongPayload[]; songs: SongloftRemoteSong[] }> {
    if (songs.length === 0) {
      return { total: 0, payloads: [], songs: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    const acceptedSongs: SearchResultSong[] = [];
    for (const song of songs) {
      const playback = await this.resolvePlayback(song);
      const enriched = withPlaybackQuality(song, playback.quality);
      payloads.push(toImportRemoteSong(enriched, playback.url));
      acceptedSongs.push(enriched);
    }

    const token = await songloft.plugin.getToken();
    const host = await requireHostBaseUrl();
    const imported = await postRemoteSongs(host, token, payloads);
    const importedSongs: SongloftRemoteSong[] = [];
    if (!imported.ok) {
      if (!isDuplicateRemoteSongError(imported.body)) {
        throw remoteImportError(imported.status, imported.body);
      }

      for (const [index, payload] of payloads.entries()) {
        const sourceSong = acceptedSongs[index];
        const single = await postRemoteSongs(host, token, [payload]);
        if (!single.ok && !isDuplicateRemoteSongError(single.body)) {
          throw remoteImportError(single.status, single.body);
        }
        const resolvedSongs = single.ok
          ? compactRemoteSongs(await completeImportedSongs(host, token, [payload], single.songs))
          : await existingSongsForPayloads(host, token, [payload]);
        importedSongs.push(...resolvedSongs);
        if (sourceSong && resolvedSongs.length > 0) {
          startImportedSongLyricSync(host, token, [sourceSong], resolvedSongs);
        }
      }
    } else {
      // 歌词同步按下标配对，必须先用保持 payload 顺序（含空位）的结果同步，再压缩。
      const completed = await completeImportedSongs(host, token, payloads, imported.songs);
      startImportedSongLyricSync(host, token, acceptedSongs, completed);
      importedSongs.push(...compactRemoteSongs(completed));
    }

    return { total: payloads.length, payloads, songs: importedSongs };
  }

  async importSongsBestEffort(songs: SearchResultSong[]): Promise<{
    total: number;
    skipped: number;
    payloads: RemoteSongPayload[];
    songs: SongloftRemoteSong[];
    errors: Array<{ title: string; message: string }>;
  }> {
    if (songs.length === 0) {
      return { total: 0, skipped: 0, payloads: [], songs: [], errors: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    const acceptedSongs: SearchResultSong[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    for (const song of songs) {
      try {
        const playback = await this.resolvePlayback(song);
        const enriched = withPlaybackQuality(song, playback.quality);
        payloads.push(toImportRemoteSong(enriched, playback.url));
        acceptedSongs.push(enriched);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ title: song.title, message });
        songloft.log.warn(`[BridgeService] Skip song import "${song.title}": ${sanitizeProviderError(error)}`);
      }
    }

    if (payloads.length === 0) {
      return { total: 0, skipped: errors.length, payloads: [], songs: [], errors };
    }

    const token = await songloft.plugin.getToken();
    const host = await requireHostBaseUrl();
    const imported = await postRemoteSongs(host, token, payloads);
    if (!imported.ok) {
      if (!isDuplicateRemoteSongError(imported.body)) {
        errors.push({ title: 'Songloft 歌曲库', message: remoteImportError(imported.status, imported.body).message });
        songloft.log.warn(`[BridgeService] Remote song import failed: ${imported.status} ${sanitizeProviderError(imported.body)}`);
        return { total: 0, skipped: songs.length, payloads: [], songs: [], errors };
      }

      const acceptedPayloads: RemoteSongPayload[] = [];
      const importedSongs: SongloftRemoteSong[] = [];
      for (const [index, payload] of payloads.entries()) {
        const sourceSong = acceptedSongs[index];
        const single = await postRemoteSongs(host, token, [payload]);
        if (single.ok) {
          const resolvedSongs = compactRemoteSongs(await completeImportedSongs(host, token, [payload], single.songs));
          acceptedPayloads.push(payload);
          importedSongs.push(...resolvedSongs);
          if (sourceSong && resolvedSongs.length > 0) {
            startImportedSongLyricSync(host, token, [sourceSong], resolvedSongs);
          }
        } else if (isDuplicateRemoteSongError(single.body)) {
          const resolvedSongs = await existingSongsForPayloads(host, token, [payload]);
          if (resolvedSongs.length > 0) {
            acceptedPayloads.push(payload);
            importedSongs.push(...resolvedSongs);
            if (sourceSong) {
              startImportedSongLyricSync(host, token, [sourceSong], resolvedSongs);
            }
          } else {
            errors.push({ title: payload.title, message: 'Songloft 曲库已有该歌曲，但未能回查到 song id，无法加入歌单' });
          }
        } else {
          errors.push({ title: payload.title, message: remoteImportError(single.status, single.body).message });
        }
      }
      return {
        total: acceptedPayloads.length,
        skipped: songs.length - acceptedPayloads.length,
        payloads: acceptedPayloads,
        songs: importedSongs,
        errors,
      };
    }

    const completed = await completeImportedSongs(host, token, payloads, imported.songs);
    startImportedSongLyricSync(host, token, acceptedSongs, completed);

    return {
      total: payloads.length,
      skipped: songs.length - payloads.length,
      payloads,
      songs: compactRemoteSongs(completed),
      errors,
    };
  }

  async playOnSpeaker(accountId: string, deviceId: string, song: SearchResultSong): Promise<{ url: string }> {
    if (this.downloads) {
      const downloaded = await this.downloads.downloadSong(song);
      const playerSong = toImportedPlayerSong(song, { id: downloaded.song_id, type: 'local' });
      if (!playerSong) {
        throw new StarlightError('INTERNAL_ERROR', 'Songloft 下载未返回可播放歌曲 ID', true);
      }
      const played = this.playlistManagerMap
        ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone(
          [playerSong],
          0,
          'single',
          { autoAdvance: false },
        )
        : await this.minaService.playURL(accountId, deviceId, await URLBuilder.buildSongURL(playerSong));
      if (!played) {
        throw new StarlightError('DEVICE_OFFLINE', '音箱播放 Songloft 已下载歌曲失败', true);
      }
      return { url: playerSong.url };
    }
    const attemptedSources = new Set<string>();
    const failures: string[] = [];
    const songloftUrl = await this.tryPlayImportedSongOnSpeaker(accountId, deviceId, song, failures);
    if (songloftUrl) {
      return { url: songloftUrl };
    }

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

  async playSonglistOnSpeaker(accountId: string, deviceId: string, songs: SpeakerQueueEntry[]): Promise<{ urls: string[] }> {
    if (songs.length === 0) {
      throw new StarlightError('BAD_REQUEST', 'songs must not be empty');
    }

    const playerSongs: PlayerSong[] = [];
    const urls: string[] = [];
    for (const song of songs) {
      // 已带播放地址的条目直接用，跳过一次多余（且缺 source_data 时不可能成功）的音源解析
      const target = isResolvedSpeakerSong(song)
        ? { url: song.playback_url, songId: song.song_id }
        : await this.resolvePlaybackTarget(song);
      playerSongs.push(toPlayerSong(song, target.url, target.songId));
      urls.push(target.url);
    }

    const played = this.playlistManagerMap
      ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone(playerSongs, 0, 'order')
      : await this.minaService.playURL(accountId, deviceId, urls[0]);
    if (!played) {
      throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    }

    // 歌词补全由 PlaylistManager 独家负责：它持有队列、知道何时切歌，
    // 会在每次切歌时补当前曲与下一曲。这里不能再补一遍，否则前几首会被
    // 两套实现重复解析——两边不共享 in-flight 状态，音源限流时反而降低成功率，
    // 且响应先后不同会互相覆盖。playerSongs 已带 source_data，管理器据此解析。
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

  /**
   * Search all enabled platforms by title/artist and return the playable hit
   * with the highest available quality (not locked to any single source).
   */
  async resolveSearchSong(title: string, artist = ''): Promise<SearchResultSong | null> {
    const resolved = await this.findPlayableSearchSong(title, artist);
    return resolved?.song ?? null;
  }

  /**
   * 自建歌单 dynamic 曲目的解析入口（PlaylistManager.playCurrentOnce → dynamicSongResolver）。
   *
   * 调用方用 `Object.assign(song, resolved)` 把结果并进队列对象，是一次即时拷贝，
   * 所以这里不能异步回填歌词——写在返回对象上同步不到队列。改为把 source_data 一并
   * 带出去：合并之后队列对象自己就带上了音源信息，PlaylistManager 会在切歌时
   * 按需解析歌词并写回它自己持有的对象。
   */
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

  private async findPlayableSearchSong(
    title: string,
    artist: string,
  ): Promise<{ song: SearchResultSong; url: string; quality: MusicQuality; matchScore: number } | null> {
    const candidates: Array<{
      song: SearchResultSong;
      url: string;
      quality: MusicQuality;
      matchScore: number;
    }> = [];

    const bestPossibleScore = maxCandidateScore(artist);
    for await (const resolved of this.iterPlayableSearchCandidates(title, artist)) {
      candidates.push(resolved);
      // 已拿到音质阶梯顶端 + 完全匹配的候选，后面的音源不可能更好，
      // 提前结束可以省掉其余平台的搜索与逐档播放探测。
      if (qualityRank(resolved.quality) >= TOP_QUALITY_RANK && resolved.matchScore >= bestPossibleScore) {
        break;
      }
    }

    if (!candidates.length) return null;

    // Prefer highest quality channel, then better title/artist match.
    candidates.sort((a, b) => {
      const qualityDiff = qualityRank(b.quality) - qualityRank(a.quality);
      if (qualityDiff !== 0) return qualityDiff;
      return b.matchScore - a.matchScore;
    });

    return candidates[0];
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
      // Candidates resolved through the quality ladder have no Songloft id (songId 0);
      // their lyrics are filled in after playback starts.
      const target = resolvedUrl ? { url: resolvedUrl, songId: 0 } : await this.resolvePlaybackTarget(song);
      const playerSong = toPlayerSong(song, target.url, target.songId);
      const played = this.playlistManagerMap
        ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone(
          [playerSong],
          0,
          'single',
          { autoAdvance: false },
        )
        : await this.minaService.playURL(accountId, deviceId, target.url);
      if (!played) {
        failures.push('音箱播放 URL 失败');
        return null;
      }

      // 同上：歌词由 PlaylistManager 在切歌时按需补，不在这里重复发起。
      return target.url;
    } catch (error) {
      failures.push(sanitizeProviderError(error));
      return null;
    }
  }

  private async tryPlayImportedSongOnSpeaker(
    accountId: string,
    deviceId: string,
    song: SearchResultSong,
    failures: string[],
  ): Promise<string | null> {
    try {
      const imported = await this.importSongs([song]);
      const playerSong = toImportedPlayerSong(song, imported.songs[0]);
      if (!playerSong) {
        failures.push('Songloft 导入未返回可播放歌曲 ID');
        return null;
      }

      const played = this.playlistManagerMap
        ? await (await this.playlistManagerMap.getOrCreate(accountId, deviceId)).playStandalone(
          [playerSong],
          0,
          'single',
          { autoAdvance: false },
        )
        : await this.minaService.playURL(accountId, deviceId, await URLBuilder.buildSongURL(playerSong));
      if (!played) {
        failures.push('音箱播放 Songloft 歌曲失败');
        return null;
      }

      return playerSong.url;
    } catch (error) {
      const message = sanitizeProviderError(error);
      failures.push(`Songloft 播放导入失败：${message}`);
      songloft.log.warn(`[BridgeService] Import before speaker playback failed "${song.title}": ${message}`);
      return null;
    }
  }

  private async *iterPlayableSearchCandidates(
    title: string,
    artist: string,
    attemptedSources?: Set<string>,
    failures?: string[],
  ): AsyncGenerator<
    { song: SearchResultSong; url: string; quality: MusicQuality; matchScore: number },
    void,
    void
  > {
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
          .sort((a, b) => b.score - a.score)
          // Cap per-platform probes so multi-source highest-quality pick stays responsive.
          .slice(0, 3);

        for (const candidate of candidates) {
          try {
            const playback = await this.resolvePlayback(candidate.song);
            const song = withPlaybackQuality(candidate.song, playback.quality);
            yield {
              song,
              url: playback.url,
              quality: playback.quality,
              matchScore: candidate.score,
            };
          } catch (error) {
            failures?.push(sanitizeProviderError(error));
            songloft.log.warn(
              `[BridgeService] Resolved search hit is not playable on ${platform.id}: ${sanitizeProviderError(error)}`,
            );
          }
        }
      } catch (error) {
        failures?.push(sanitizeProviderError(error));
        songloft.log.warn(
          `[BridgeService] Resolve search provider ${platform.id} failed: ${sanitizeProviderError(error)}`,
        );
      }
    }
  }
}

const TOP_QUALITY_RANK = QUALITY_RANK[PLAYBACK_QUALITY_LADDER[0]];

function qualityRank(quality: string): number {
  return QUALITY_RANK[String(quality || '').toLowerCase()] || 0;
}

/** Highest score scoreResolvedCandidate can return for this query. */
function maxCandidateScore(artist: string): number {
  return artist.trim() ? 140 : 100;
}

/**
 * Always probe highest → lowest quality, regardless of what the search hit declared.
 * A source may advertise 320k while still serving flac; multi-source resolve then
 * picks the channel that actually delivered the best playable URL.
 */
function qualitiesToTry(_song: SearchResultSong): MusicQuality[] {
  return [...PLAYBACK_QUALITY_LADDER];
}

function withPlaybackQuality(song: SearchResultSong, quality: MusicQuality): SearchResultSong {
  if (song.source_data.quality === quality) return song;
  return {
    ...song,
    source_data: {
      ...song.source_data,
      quality,
      songInfo: { ...song.source_data.songInfo },
    },
  };
}

/**
 * @param songId Songloft 歌曲 ID；0 表示直连音源 URL，宿主没有这首歌，
 *   此时 lyric_url 只能留空，改由 PlaylistManager 在切歌时按需补 lyric_text。
 */
function toPlayerSong(song: Omit<SpeakerQueueEntry, 'source_data' | 'playback_url' | 'song_id'>, url: string, songId = 0): PlayerSong {
  return {
    id: songId,
    type: 'remote',
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    file_path: '',
    url,
    cover_path: '',
    cover_url: song.cover_url,
    lyric_url: songId > 0 ? `/api/v1/songs/${songId}/lyric` : '',
    file_size: 0,
    format: '',
    bit_rate: 0,
    sample_rate: 0,
    is_live: false,
    cache_hash: '',
    // 带上音源信息，PlaylistManager 才能在切歌时按需补歌词（不进 getStatus 投影）
    ...(isResolvedSpeakerSong(song as SpeakerQueueEntry)
      ? {}
      : { source_data: (song as SearchResultSong).source_data as unknown as PlayerSong['source_data'] }),
  };
}

function toImportedPlayerSong(sourceSong: SearchResultSong, importedSong: SongloftRemoteSong | undefined): PlayerSong | null {
  const songId = numericRemoteSongId(importedSong);
  if (!songId || !importedSong) {
    return null;
  }
  const native = importedSong;

  return {
    id: songId,
    type: remoteSongField(native, 'type') || 'remote',
    title: remoteSongField(native, 'title', 'name', 'songName') || sourceSong.title,
    artist: remoteSongField(native, 'artist', 'singer', 'author', 'singerName') || sourceSong.artist,
    album: remoteSongField(native, 'album', 'albumName') || sourceSong.album,
    duration: remoteSongNumberField(native, 'duration') || sourceSong.duration,
    file_path: remoteSongField(native, 'file_path', 'filePath'),
    url: `/api/v1/songs/${songId}/play`,
    cover_path: remoteSongField(native, 'cover_path', 'coverPath'),
    cover_url: remoteSongField(native, 'cover_url', 'coverUrl') || sourceSong.cover_url,
    lyric_url: remoteSongField(native, 'lyric_url', 'lyricUrl') || `/api/v1/songs/${songId}/lyric`,
    file_size: remoteSongNumberField(native, 'file_size', 'fileSize'),
    format: remoteSongField(native, 'format') || sourceSong.source_data.quality,
    bit_rate: remoteSongNumberField(native, 'bit_rate', 'bitRate'),
    sample_rate: remoteSongNumberField(native, 'sample_rate', 'sampleRate'),
    is_live: Boolean((native as Record<string, unknown>).is_live || (native as Record<string, unknown>).isLive),
    cache_hash: remoteSongField(native, 'cache_hash', 'cacheHash'),
  };
}

function numericRemoteSongId(song: SongloftRemoteSong | undefined): number {
  const id = Number((song as { id?: unknown } | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function toImportRemoteSong(song: SearchResultSong, url: string): RemoteSongPayload {
  const payload = toRemoteSong(song, url, { pluginEntryPath: STARLIGHT_PLUGIN_ENTRY_PATH });
  return payload.dedup_key ? payload : toRemoteSong(song, url);
}

function hasUsableSongId(song: SongloftRemoteSong | undefined): song is SongloftRemoteSong {
  if (!song || typeof song !== 'object') {
    return false;
  }
  const id = (song as { id?: unknown }).id;
  if (typeof id === 'number') {
    return Number.isInteger(id) && id > 0;
  }
  if (typeof id === 'string' && id.trim() !== '') {
    const parsed = Number(id);
    return Number.isInteger(parsed) && parsed > 0;
  }
  return false;
}

/**
 * Resolve one Songloft song per payload, keeping payload order: unresolved slots
 * stay as null so callers can still pair imported songs back to their source song
 * by index. Dropping the holes here would shift every later pair by one.
 */
async function completeImportedSongs(
  host: string,
  token: string,
  payloads: RemoteSongPayload[],
  importedSongs: SongloftRemoteSong[],
): Promise<Array<SongloftRemoteSong | null>> {
  const completed: Array<SongloftRemoteSong | null> = payloads.map((_, index) => {
    const song = importedSongs[index];
    return song && typeof song === 'object' ? song : null;
  });
  for (const [index, payload] of payloads.entries()) {
    if (hasUsableSongId(completed[index] ?? undefined)) {
      continue;
    }
    const existing = await findExistingRemoteSong(host, token, payload);
    if (existing) {
      completed[index] = existing;
    }
  }
  return completed;
}

function compactRemoteSongs(songs: Array<SongloftRemoteSong | null>): SongloftRemoteSong[] {
  return songs.filter((song): song is SongloftRemoteSong => Boolean(song));
}

async function existingSongsForPayloads(host: string, token: string, payloads: RemoteSongPayload[]): Promise<SongloftRemoteSong[]> {
  const songs: SongloftRemoteSong[] = [];
  for (const payload of payloads) {
    const existing = await findExistingRemoteSong(host, token, payload);
    if (existing) {
      songs.push(existing);
    }
  }
  return songs;
}

async function findExistingRemoteSong(host: string, token: string, payload: RemoteSongPayload): Promise<SongloftRemoteSong | null> {
  const keyword = payload.title.trim();
  if (!keyword) {
    return null;
  }
  const baseHost = normalizeHostBaseUrl(host);
  const response = await fetch(
    `${baseHost}/api/v1/songs?type=remote&keyword=${encodeURIComponent(keyword)}&limit=${EXISTING_REMOTE_SONG_LOOKUP_LIMIT}&offset=0`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    songloft.log.warn(`[BridgeService] Existing remote song lookup failed: ${response.status} ${await safeResponseText(response)}`);
    return null;
  }
  const candidates = remoteSongsFromListBody(await safeResponseJson(response));
  return bestMatchingRemoteSong(candidates, payload);
}

function remoteSongsFromListBody(body: unknown): SongloftRemoteSong[] {
  if (Array.isArray(body)) {
    return body as SongloftRemoteSong[];
  }
  if (!body || typeof body !== 'object') {
    return [];
  }

  const record = body as Record<string, unknown>;
  for (const key of ['songs', 'list', 'items'] as const) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value as SongloftRemoteSong[];
    }
  }
  if (record.data && typeof record.data === 'object') {
    return remoteSongsFromListBody(record.data);
  }
  return [];
}

function bestMatchingRemoteSong(candidates: SongloftRemoteSong[], payload: RemoteSongPayload): SongloftRemoteSong | null {
  const withIds = candidates.filter(hasUsableSongId);
  return withIds.find((song) => pluginDedupMatches(song, payload))
    || withIds.find((song) => sourceDataMatches(song, payload))
    || withIds.find((song) => remoteSongField(song, 'url', 'play_url', 'playUrl') === payload.url)
    || withIds.find((song) => titleArtistAlbumMatches(song, payload))
    || withIds.find((song) => titleArtistMatches(song, payload))
    || null;
}

function pluginDedupMatches(song: SongloftRemoteSong, payload: RemoteSongPayload): boolean {
  if (!payload.plugin_entry_path || !payload.dedup_key) {
    return false;
  }
  return remoteSongField(song, 'plugin_entry_path') === payload.plugin_entry_path
    && remoteSongField(song, 'dedup_key') === payload.dedup_key;
}

function sourceDataMatches(song: SongloftRemoteSong, payload: RemoteSongPayload): boolean {
  if (!payload.source_data) {
    return false;
  }
  const existing = (song as Record<string, unknown>).source_data;
  if (typeof existing === 'string') {
    return stableJsonText(existing) === stableJsonText(payload.source_data);
  }
  if (existing && typeof existing === 'object') {
    return stableJsonValue(existing) === stableJsonText(payload.source_data);
  }
  return false;
}

function titleArtistAlbumMatches(song: SongloftRemoteSong, payload: RemoteSongPayload): boolean {
  const album = remoteSongField(song, 'album', 'albumName');
  if (!album && !payload.album) {
    return titleArtistMatches(song, payload);
  }
  return titleArtistMatches(song, payload) && normalizeSongText(album) === normalizeSongText(payload.album);
}

function titleArtistMatches(song: SongloftRemoteSong, payload: RemoteSongPayload): boolean {
  return normalizeSongText(remoteSongField(song, 'title', 'name', 'songName')) === normalizeSongText(payload.title)
    && normalizeSongText(remoteSongField(song, 'artist', 'singer', 'author', 'singerName')) === normalizeSongText(payload.artist);
}

function remoteSongField(song: SongloftRemoteSong, ...keys: string[]): string {
  const record = song as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  }
  return '';
}

function remoteSongNumberField(song: SongloftRemoteSong, ...keys: string[]): number {
  const record = song as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function stableJsonText(value: string): string {
  try {
    return stableJsonValue(JSON.parse(value));
  } catch {
    return value.trim();
  }
}

function stableJsonValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce<Record<string, unknown>>((sorted, key) => {
    sorted[key] = sortJsonValue(record[key]);
    return sorted;
  }, {});
}


function playbackFallbackError(attemptedCount: number, failures: string[]): StarlightError {
  const lastFailure = failures.length > 0 ? failures[failures.length - 1] : '未找到可用音源';
  const message = `播放失败，已尝试 ${attemptedCount} 个播放音源；最后失败原因：${lastFailure}`;
  const code = lastFailure.includes('音箱播放') ? 'DEVICE_OFFLINE' : 'PLAY_URL_RESOLVE_FAILED';
  return new StarlightError(code, message, true, { attempts: attemptedCount, lastFailure });
}

function playUrlResolveFailureMessage(attemptedCount: number, lastFailure: string | null): string {
  if (attemptedCount > 0 || lastFailure) {
    return `无法解析播放 URL，已尝试 ${attemptedCount} 个播放音源；最后失败原因：${lastFailure || '未找到可用播放音源'}`;
  }
  return '无法解析播放 URL';
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

function startImportedSongLyricSync(
  host: string,
  token: string,
  songs: SearchResultSong[],
  importedSongs: Array<SongloftRemoteSong | null>,
): void {
  if (songs.length === 0 || importedSongs.length === 0) {
    return;
  }

  void syncImportedSongLyrics(host, token, songs, importedSongs).catch((error) => {
    songloft.log.warn(`[BridgeService] Deferred lyric sync failed: ${sanitizeProviderError(error)}`);
  });
}

type ImportedSongPair = {
  song: SearchResultSong;
  imported: SongloftRemoteSong;
};

/**
 * 归一化时间标签为 `[MM:SS.mmm]` 后再下发。
 * 前端 parseLrc 只认 `[\d{2}:\d{2}(.\d{2,3})?]`：一位分钟（`[0:12.34]`）
 * 或一位小数（`[00:12.5]`）都会让整行被丢掉，等于没有歌词。
 * 没有任何时间标签的纯文本歌词无法逐行滚动，直接当作没拿到。
 */
/**
 * 解析单曲歌词，供 PlaylistManager 在切歌时按需调用。
 * 拿不到就返回空串——歌词永远不该影响播放。
 */
export async function resolvePlayerSongLyric(song: PlayerSong): Promise<string> {
  const source = song.source_data;
  if (!source?.platform || !source.songInfo) {
    return '';
  }
  try {
    const lyric = await resolveMusicLyric(
      source.platform as SearchResultSong['source_data']['platform'],
      source.songInfo as unknown as SearchResultSong['source_data']['songInfo'],
    );
    return playerLyricText(lyric?.lyric || '');
  } catch {
    return '';
  }
}

function playerLyricText(lyric: string): string {
  const text = String(lyric || '').replace(/\r\n?/g, '\n').trim();
  if (!text) {
    return '';
  }

  let hasTimeTag = false;
  const normalized = text.replace(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, (_match, minute: string, second: string, fraction?: string) => {
    hasTimeTag = true;
    const mm = String(Number(minute)).padStart(2, '0');
    const ss = String(Number(second)).padStart(2, '0');
    const ms = String(fraction || '0').padEnd(3, '0').slice(0, 3);
    return `[${mm}:${ss}.${ms}]`;
  });

  return hasTimeTag ? normalized : '';
}

export async function postRemoteSongs(host: string, token: string, payloads: RemoteSongPayload[]): Promise<RemoteImportResult> {
  const baseHost = normalizeHostBaseUrl(host);
  const response = await fetch(`${baseHost}/api/v1/songs/remote`, {
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

async function syncImportedSongLyrics(
  host: string,
  token: string,
  songs: SearchResultSong[],
  importedSongs: Array<SongloftRemoteSong | null>,
): Promise<void> {
  const pairs = importedSongs
    .map((imported, index) => ({ song: songs[index], imported }))
    .filter((pair): pair is ImportedSongPair => Boolean(pair.song && pair.imported && pair.imported.id));

  for (const pair of pairs) {
    try {
      const lyric = await resolveMusicLyric(pair.song.source_data.platform, pair.song.source_data.songInfo);
      await updateHostSongLyrics(host, token, Number(pair.imported.id), lyric);
    } catch (error) {
      songloft.log.warn(`[BridgeService] Sync lyrics failed for "${pair.song.title}": ${sanitizeProviderError(error)}`);
    }
  }
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
