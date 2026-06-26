import { describe, expect, it } from 'vitest';

interface SonglistsModule {
  songListId(item: Record<string, unknown>): unknown;
  renderSongListsForTest?(items: Array<Record<string, unknown>>): string;
}

interface RankingsModule {
  boardId(item: Record<string, unknown>): unknown;
}

async function loadSonglistsModule(): Promise<SonglistsModule> {
  const modulePath = '../../static/js/music_modules/songlists.js';
  return await import(modulePath) as SonglistsModule;
}

async function loadRankingsModule(): Promise<RankingsModule> {
  const modulePath = '../../static/js/music_modules/rankings.js';
  return await import(modulePath) as RankingsModule;
}

describe('music songlist and ranking helpers', () => {
  it('resolves the first available songlist id field', async () => {
    const { songListId } = await loadSonglistsModule();

    expect(songListId({ id: 'direct-id', list_id: 'fallback-id' })).toBe('direct-id');
    expect(songListId({ list_id: 'list-id', songlist_id: 'songlist-id' })).toBe('list-id');
    expect(songListId({ songlist_id: 'songlist-id', source_id: 'source-id' })).toBe('songlist-id');
    expect(songListId({ source_id: 'source-id', play_count: 'count-id' })).toBe('source-id');
    expect(songListId({ play_count: 'count-id' })).toBe('count-id');
  });

  it('resolves the first available ranking board id field', async () => {
    const { boardId } = await loadRankingsModule();

    expect(boardId({ id: 'direct-id', board_id: 'fallback-id' })).toBe('direct-id');
    expect(boardId({ board_id: 'board-id', source_id: 'source-id' })).toBe('board-id');
    expect(boardId({ source_id: 'source-id', bangid: 'bang-id' })).toBe('source-id');
    expect(boardId({ bangid: 'bang-id', 榜单id: 'legacy-id' })).toBe('bang-id');
    expect(boardId({ 榜单id: 'legacy-id' })).toBe('legacy-id');
  });

  it('exposes unified playlist actions for discovered songlists and detail songs', async () => {
    const songlists = await loadSonglistsModule();
    const source = String(await import('node:fs').then(({ readFileSync }) => readFileSync('static/js/music_modules/songlists.js', 'utf8')));

    expect(source).toContain('import-songlist-to-playlist');
    expect(source).toContain('add-selected-songlist-detail-to-playlist');
    expect(source).not.toContain('import-songlist-to-songloft');
    expect(source).not.toContain('add-selected-songlist-detail-to-songloft');
    expect(source).toContain('/songloft/playlists/import-source-songlist/jobs');
    expect(source).toContain('trackSongloftImportJob');
    expect(source).toContain('openSongloftPlaylistTarget');
    expect(songlists.songListId({ id: '3360244412' })).toBe('3360244412');
  });

  it('exposes unified playlist actions for ranking songs', async () => {
    const source = String(await import('node:fs').then(({ readFileSync }) => readFileSync('static/js/music_modules/rankings.js', 'utf8')));

    expect(source).toContain('add-selected-ranking-to-playlist');
    expect(source).not.toContain('add-selected-ranking-to-songloft');
    expect(source).toContain('ranking-song-check');
    expect(source).toContain('openSongloftPlaylistTarget');
  });
});
