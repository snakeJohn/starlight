import type { Router } from '@songloft/plugin-sdk';
import { BridgeService, type SpeakerQueueEntry } from '../bridge/service';
import type { SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import {
  objectField,
  requireString,
  stringField,
  stringishField,
} from '../system/fields';
import { runApi } from '../system/response';

interface SongBody {
  song?: unknown;
}

interface SongsBody {
  songs?: unknown;
}

interface PlayBody {
  account_id?: unknown;
  device_id?: unknown;
  song?: unknown;
}

interface ExternalSearchBody {
  keyword?: unknown;
}

interface ResolvedPlayBody {
  account_id?: unknown;
  device_id?: unknown;
  title?: unknown;
  artist?: unknown;
}

function requireSong(value: unknown): SearchResultSong {
  const song = objectField(value);
  if (!song) {
    throw new StarlightError('BAD_REQUEST', 'song is required');
  }

  const sourceData = objectField(song.source_data);
  if (!sourceData) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data is required');
  }

  const platform = stringField(sourceData.platform);
  if (!platform) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.platform is required');
  }

  const quality = stringField(sourceData.quality);
  if (!quality) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.quality is required');
  }

  const songInfo = objectField(sourceData.songInfo);
  if (!songInfo) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.songInfo is required');
  }

  const rawDuration = song.duration;
  const duration =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration)
      ? rawDuration
      : typeof rawDuration === 'string' && rawDuration.trim() !== '' && Number.isFinite(Number(rawDuration))
        ? Number(rawDuration)
        : 0;

  return {
    title: stringishField(song.title),
    artist: stringishField(song.artist),
    album: stringishField(song.album),
    duration,
    cover_url: stringishField(song.cover_url),
    source_data: {
      platform: platform as SearchResultSong['source_data']['platform'],
      quality: quality as SearchResultSong['source_data']['quality'],
      songInfo: songInfo as unknown as SearchResultSong['source_data']['songInfo'],
    },
  };
}

function requireSongs(value: unknown): SearchResultSong[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'songs must be an array');
  }
  return value.map((entry) => requireSong(entry));
}

/** 只接受能安全推给音箱的地址：宿主歌曲端点，或已解析的 http(s) 直链。 */
function playbackUrlOf(song: Record<string, unknown>): string {
  const raw = stringField(song.url) || stringField(song.play_url);
  if (!raw) {
    return '';
  }
  if (raw.startsWith('/api/v1/songs/')) {
    return raw;
  }
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** 从 /api/v1/songs/{id}/play 提取宿主歌曲 ID；提取不到返回 0。 */
function hostSongIdOf(song: Record<string, unknown>, playbackUrl: string): number {
  const direct = Number(song.id ?? song.song_id);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }
  const matched = /^\/api\/v1\/songs\/(\d+)\//.exec(playbackUrl);
  return matched ? Number(matched[1]) : 0;
}

/**
 * 音箱队列条目：可能带 source_data（搜索结果直推），也可能只带已解析的播放地址
 * （音箱 → 浏览器 → 音箱 来回切换时，状态接口的 queue 条目不带 source_data）。
 * 后者以前会被 requireSong 以 "song.source_data is required" 拒掉，导致切回音箱报错。
 */
function requireSpeakerQueueSongs(value: unknown): SpeakerQueueEntry[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'songs must be an array');
  }

  return value.map((entry) => {
    const song = objectField(entry);
    if (!song) {
      throw new StarlightError('BAD_REQUEST', 'song is required');
    }

    if (objectField(song.source_data)) {
      return requireSong(entry);
    }

    const playbackUrl = playbackUrlOf(song);
    if (!playbackUrl) {
      // 既没有音源信息也没有可播地址，才是真的没法播
      throw new StarlightError('BAD_REQUEST', 'song.source_data or a playable song.url is required');
    }

    const rawDuration = Number(song.duration);
    return {
      title: stringishField(song.title) || stringishField(song.name),
      artist: stringishField(song.artist),
      album: stringishField(song.album),
      duration: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0,
      cover_url: stringishField(song.cover_url) || stringishField(song.cover),
      playback_url: playbackUrl,
      song_id: hostSongIdOf(song, playbackUrl),
    };
  });
}

export function registerBridgeHandlers(router: Router, bridge: BridgeService): void {
  router.post('/api/bridge/preview-url', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<SongBody>(req);
      return { url: await bridge.previewUrl(requireSong(body.song)) };
    }));

  router.post('/api/bridge/preview-lyric', async (req) =>
    runApi(() => {
      const body = parseJsonBody<SongBody>(req);
      return bridge.previewLyric(requireSong(body.song));
    }));

  router.post('/api/bridge/songs/import', async (req) =>
    runApi(() => {
      const body = parseJsonBody<SongsBody>(req);
      return bridge.importSongs(requireSongs(body.songs));
    }));

  router.post('/api/bridge/play-url', async (req) =>
    runApi(() => {
      const body = parseJsonBody<PlayBody>(req);
      return bridge.playOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireSong(body.song),
      );
    }));

  router.post('/api/bridge/play-songlist', async (req) =>
    runApi(() => {
      const body = parseJsonBody<PlayBody & SongsBody>(req);
      return bridge.playSonglistOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireSpeakerQueueSongs(body.songs),
      );
    }));

  router.post('/api/bridge/play-resolved-url', async (req) =>
    runApi(() => {
      const body = parseJsonBody<ResolvedPlayBody>(req);
      return bridge.playResolvedOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireString(body.title, 'title'),
        stringishField(body.artist),
      );
    }));

  router.post('/api/bridge/external-search', async (req) =>
    runApi(() => {
      const body = parseJsonBody<ExternalSearchBody>(req);
      return bridge.externalSearch(requireString(body.keyword, 'keyword'));
    }));
}
