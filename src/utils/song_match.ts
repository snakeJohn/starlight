import type { MusicPlatform, SearchResultSong } from '../music/types';

/** Shared platform display names (UI + LX mapper + custom playlists). */
export const PLATFORM_SOURCE_NAMES: Record<MusicPlatform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ 音乐',
  mg: '咪咕',
  wy: '网易云',
};

export function platformSourceName(platform: string): string {
  return PLATFORM_SOURCE_NAMES[platform as MusicPlatform] || platform;
}

/** Normalize title/artist text for fuzzy matching. */
export function normalizeSongText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[《》【】[\]（）()\s_\-·,，.。]/g, '');
}

export function textMatches(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeSongText(expected);
  const normalizedActual = normalizeSongText(actual);
  return Boolean(
    normalizedExpected
    && normalizedActual
    && (
      normalizedActual === normalizedExpected
      || normalizedActual.includes(normalizedExpected)
      || normalizedExpected.includes(normalizedActual)
    ),
  );
}

/** Score a search candidate against expected title/artist (0 = no match). */
export function scoreResolvedCandidate(
  title: string,
  artist: string,
  song: Pick<SearchResultSong, 'title' | 'artist'>,
): number {
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

const SONG_ID_FIELDS = [
  'musicId',
  'songmid',
  'songId',
  'rid',
  'id',
  'mid',
  'hash',
  'copyrightId',
  'strMediaMid',
] as const;

function firstNonEmptyId(info: unknown): string {
  if (!info || typeof info !== 'object') {
    return '';
  }
  const record = info as Record<string, unknown>;
  for (const field of SONG_ID_FIELDS) {
    const candidate = record[field];
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Stable song identity across import / play / voice / LX paths.
 * Prefer platform-scoped media id; fall back to title:artist text key.
 */
export function stableSongKey(song: {
  title?: string;
  artist?: string;
  source_data?: {
    platform?: string;
    songInfo?: unknown;
  };
}): string {
  const platform = song.source_data?.platform || '';
  const id = firstNonEmptyId(song.source_data?.songInfo);
  if (platform && id) {
    return `${platform}:${id}`;
  }
  const title = song.title || '';
  const artist = song.artist || '';
  if (platform) {
    return `${platform}:${title}:${artist}`;
  }
  return `query:${normalizeSongText(title)}:${normalizeSongText(artist)}`;
}

/** Alias used by remote import / Songloft dedup. */
export function remoteSongDedupKey(song: SearchResultSong): string {
  const info = song.source_data?.songInfo;
  const id = firstNonEmptyId(info);
  return id ? `${song.source_data.platform}:${id}` : '';
}

/** Redact secrets from error / log strings. */
export function sanitizeProviderError(error: unknown, maxLen = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, maxLen);
}
