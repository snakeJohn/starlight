import { describe, expect, test } from 'vitest';
import type { SearchResultSong } from '../../src/music/types';
import {
  normalizeSongText,
  platformSourceName,
  remoteSongDedupKey,
  sanitizeProviderError,
  scoreResolvedCandidate,
  stableSongKey,
  textMatches,
} from '../../src/utils/song_match';

function songInfo(extra: Record<string, unknown> = {}) {
  return {
    source: 'wy',
    name: 't',
    singer: 'a',
    album: '',
    duration: 1,
    musicId: '123',
    ...extra,
  };
}

function song(partial: Partial<SearchResultSong> & { title: string; artist: string }): SearchResultSong {
  return {
    title: partial.title,
    artist: partial.artist,
    album: partial.album || '',
    duration: partial.duration || 0,
    cover_url: partial.cover_url || '',
    source_data: partial.source_data || {
      platform: 'wy',
      quality: '320k',
      songInfo: songInfo(),
    },
  };
}

describe('song_match', () => {
  test('normalizeSongText strips punctuation and case', () => {
    expect(normalizeSongText(' 《Hello》-World ')).toBe('helloworld');
  });

  test('textMatches allows substring either way', () => {
    expect(textMatches('周杰伦', '周杰伦 feat. 他人')).toBe(true);
    expect(textMatches('周杰伦 feat', '周杰伦')).toBe(true);
    expect(textMatches('周杰伦', '林俊杰')).toBe(false);
  });

  test('scoreResolvedCandidate ranks exact title higher', () => {
    const exact = scoreResolvedCandidate('晴天', '周杰伦', { title: '晴天', artist: '周杰伦' });
    const fuzzy = scoreResolvedCandidate('晴天', '周杰伦', { title: '晴天 (Live)', artist: '周杰伦' });
    expect(exact).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  test('stableSongKey prefers platform media id cascade', () => {
    expect(stableSongKey(song({
      title: 'A',
      artist: 'B',
      source_data: { platform: 'kg', quality: '320k', songInfo: songInfo({ hash: 'abc', musicId: 'mid1' }) },
    }))).toBe('kg:mid1');

    expect(stableSongKey(song({
      title: 'A',
      artist: 'B',
      source_data: {
        platform: 'tx',
        quality: '320k',
        songInfo: songInfo({ musicId: '', songmid: 'sm' }),
      },
    }))).toBe('tx:sm');
  });

  test('remoteSongDedupKey omits empty id', () => {
    expect(remoteSongDedupKey(song({
      title: 'A',
      artist: 'B',
      source_data: {
        platform: 'wy',
        quality: '320k',
        songInfo: songInfo({ musicId: '' }),
      },
    }))).toBe('');
  });

  test('platformSourceName and sanitizeProviderError', () => {
    expect(platformSourceName('kw')).toBe('酷我');
    expect(platformSourceName('unknown')).toBe('unknown');
    expect(sanitizeProviderError(new Error('Bearer secret-token failed'))).toContain('Bearer [redacted]');
  });
});
