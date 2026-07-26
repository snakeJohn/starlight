import { describe, expect, test, vi } from 'vitest';
import { loadFullSonglist } from '../../src/music/songlist_loader';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { SearchResultSong } from '../../src/music/types';

function makeSong(id: string): SearchResultSong {
  return {
    title: id,
    artist: 'a',
    album: '',
    duration: 1,
    cover_url: '',
    source_data: {
      platform: 'wy',
      quality: '320k',
      songInfo: {
        source: 'wy',
        name: id,
        singer: 'a',
        album: '',
        duration: 1,
        musicId: id,
      },
    },
  };
}

describe('loadFullSonglist', () => {
  test('pages until total is filled', async () => {
    const songListDetail = vi.fn(async (_id: string, page: number, pageSize: number) => {
      if (page === 1) {
        return {
          name: 'List',
          total: 3,
          songs: [makeSong('1'), makeSong('2')],
          cover_url: 'c',
        };
      }
      return {
        name: 'List',
        total: 3,
        songs: [makeSong('3')],
        cover_url: 'c',
      };
    });

    const provider = { songListDetail } as unknown as MusicPlatformProvider;
    const detail = await loadFullSonglist(provider, 'list-1', { pageSize: 2 });

    expect(detail.name).toBe('List');
    expect(detail.total).toBe(3);
    expect(detail.songs.map((s) => s.title)).toEqual(['1', '2', '3']);
    expect(songListDetail).toHaveBeenCalledTimes(2);
  });

  test('stops on short page when total is unknown', async () => {
    const songListDetail = vi.fn(async (_id: string, page: number) => {
      if (page === 1) {
        return { name: 'X', total: 0, songs: [makeSong('1'), makeSong('2')] };
      }
      return { name: 'X', total: 0, songs: [makeSong('3')] };
    });

    const provider = { songListDetail } as unknown as MusicPlatformProvider;
    const detail = await loadFullSonglist(provider, 'x', { pageSize: 2 });

    expect(detail.songs).toHaveLength(3);
    expect(songListDetail).toHaveBeenCalledTimes(2);
  });
});
