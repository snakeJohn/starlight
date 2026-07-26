import type { MusicPlatformProvider } from './platforms/types';
import type { SearchResultSong } from './types';

export const SONG_LIST_PAGE_SIZE = 100;
export const SONG_LIST_MAX_PAGES = 100;

export interface FullSongListDetail {
  name: string;
  cover_url: string;
  cover?: string;
  img?: string;
  songs: SearchResultSong[];
  total: number;
}

function numericTotal(value: unknown): number {
  const total = Number(value);
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
}

/**
 * Page through provider.songListDetail until all songs are loaded
 * (or MAX pages / short page ends the loop).
 */
export async function loadFullSonglist(
  provider: MusicPlatformProvider,
  id: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<FullSongListDetail> {
  const pageSize = options.pageSize ?? SONG_LIST_PAGE_SIZE;
  const maxPages = options.maxPages ?? SONG_LIST_MAX_PAGES;

  const first = await provider.songListDetail(id, 1, pageSize);
  const songs = Array.isArray(first.songs) ? [...first.songs] : [];
  const total = numericTotal(first.total);

  let page = 2;
  while (
    page <= maxPages
    && (
      (total > 0 && songs.length < total)
      || (total === 0 && songs.length > 0 && songs.length % pageSize === 0)
    )
  ) {
    const detail = await provider.songListDetail(id, page, pageSize);
    const pageSongs = Array.isArray(detail.songs) ? detail.songs : [];
    if (pageSongs.length === 0) {
      break;
    }
    songs.push(...pageSongs);
    if (pageSongs.length < pageSize) {
      break;
    }
    page += 1;
  }

  const cover =
    (first as { cover_url?: string; cover?: string; img?: string }).cover_url
    || (first as { cover?: string }).cover
    || (first as { img?: string }).img
    || '';

  return {
    name: first.name || id,
    cover_url: cover,
    cover,
    img: cover,
    songs: total > 0 ? songs.slice(0, total) : songs,
    total: total || songs.length,
  };
}
