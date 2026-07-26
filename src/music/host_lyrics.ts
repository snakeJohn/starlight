import type { MusicLyricResult } from './platforms/lyrics';
import { normalizeHostBaseUrl } from '../utils/http';

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** PUT scraped lyrics onto a Songloft host song. Shared by bridge import + download. */
export async function updateHostSongLyrics(
  host: string,
  token: string,
  songId: number,
  lyric: MusicLyricResult,
): Promise<void> {
  const baseHost = normalizeHostBaseUrl(host);
  const response = await fetch(`${baseHost}/api/v1/songs/${songId}/lyrics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      lyric_source: 'scraped',
      lyric: lyric.lyric,
      tlyric: lyric.tlyric || '',
      rlyric: lyric.rlyric || '',
      lxlyric: lyric.lxlyric || '',
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await safeResponseText(response)}`);
  }
}
