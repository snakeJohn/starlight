import { describe, expect, it } from 'vitest';
import { remoteSongDedupKey, toRemoteSong } from '../../src/bridge/mapper';
import type { SearchResultSong } from '../../src/music/types';

describe('toRemoteSong', () => {
  it('maps LX result to Songloft remote song payload', () => {
    const remote = toRemoteSong({
      title: 'Song',
      artist: 'Singer',
      album: 'Album',
      duration: 200,
      cover_url: 'https://img.test/a.jpg',
      source_data: {
        platform: 'kw',
        quality: '320k',
        songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: '123' },
      },
    }, 'https://audio.test/song.mp3');
    expect(remote).toMatchObject({
      title: 'Song',
      artist: 'Singer',
      album: 'Album',
      cover_url: 'https://img.test/a.jpg',
      duration: 200,
      url: 'https://audio.test/song.mp3',
      plugin_entry_path: '',
      source_data: '',
      dedup_key: '',
    });
  });

  it.each([
    ['songmid', { songmid: 'mid-1' }],
    ['hash', { hash: 'hash-1' }],
    ['copyrightId', { copyrightId: 'copy-1' }],
  ])('uses %s as a fallback dedup id', (_name, idFields) => {
    const song = {
      title: 'Song',
      artist: 'Singer',
      album: '',
      duration: 0,
      cover_url: '',
      source_data: {
        platform: 'kg',
        quality: '320k',
        songInfo: { source: 'kg', name: 'Song', singer: 'Singer', album: '', duration: 0, ...idFields },
      },
    } satisfies SearchResultSong;

    expect(remoteSongDedupKey(song)).toBe(`kg:${Object.values(idFields)[0]}`);
  });

  it('can map a resolved URL as a pure external remote song', () => {
    const remote = toRemoteSong({
      title: 'Song',
      artist: 'Singer',
      album: '',
      duration: 0,
      cover_url: '',
      source_data: {
        platform: 'kw',
        quality: 'flac',
        songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: '', duration: 0, musicId: '123' },
      },
    }, 'https://audio.test/song.flac', {
      pluginEntryPath: '',
      includeSourceData: false,
      dedupKey: '',
    });

    expect(remote).toMatchObject({
      url: 'https://audio.test/song.flac',
      plugin_entry_path: '',
      source_data: '',
      dedup_key: '',
    });
  });
});
