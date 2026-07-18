import { describe, expect, it } from 'vitest';
import { parseLxListPayload, mapPlaylistsToListData, formatInterval } from '../../src/lx_sync/mapper';
import type { CustomPlaylist } from '../../src/custom_playlists/types';

describe('parseLxListPayload (file/json based, no server)', () => {
  it('parses direct ListData', () => {
    const data = parseLxListPayload({
      defaultList: [],
      loveList: [{ id: '1', name: 'A', singer: 'B', source: 'kw', interval: '01:00', meta: {} }],
      userList: [],
    });
    expect(data.loveList).toHaveLength(1);
    expect(data.defaultList).toEqual([]);
  });

  it('parses nested data envelope and string JSON', () => {
    const nested = parseLxListPayload({
      data: { defaultList: [], loveList: [], userList: [{ id: 'u1', name: 'X', list: [] }] },
    });
    expect(nested.userList[0].name).toBe('X');

    const asString = parseLxListPayload(JSON.stringify({
      listData: { defaultList: [{ id: 'd', name: 'D', singer: 'S', source: 'wy', interval: null, meta: {} }], loveList: [], userList: [] },
    }));
    expect(asString.defaultList).toHaveLength(1);
  });

  it('rejects non-list payloads', () => {
    expect(() => parseLxListPayload({ foo: 1 })).toThrow(/未识别/);
    expect(() => parseLxListPayload('not-json')).toThrow(/invalid JSON/);
  });
});

describe('mapPlaylistsToListData export', () => {
  it('exports love / default / user playlists', () => {
    const playlists: CustomPlaylist[] = [
      {
        id: 'a',
        name: '我喜欢',
        cover_url: '',
        sourceListId: 'lx:love',
        imported_at: '',
        updated_at: '',
        songs: [{ title: 'L', artist: 'A', album: '', duration: 90, cover_url: '', stable_key: 'k1' }],
      },
      {
        id: 'b',
        name: '古风',
        cover_url: '',
        sourceListId: 'lx:user:ul1',
        imported_at: '',
        updated_at: '',
        songs: [{
          title: '为龙',
          artist: '河图',
          album: '',
          duration: 240,
          cover_url: '',
          stable_key: 'k2',
          source_data: {
            platform: 'kg',
            quality: '320k',
            songInfo: { source: 'kg', name: '为龙', singer: '河图', album: '', duration: 240, hash: 'h1' },
          },
        }],
      },
    ];
    const listData = mapPlaylistsToListData(playlists);
    expect(listData.loveList).toHaveLength(1);
    expect(listData.loveList[0].interval).toBe('01:30');
    expect(listData.userList).toHaveLength(1);
    expect(listData.userList[0].id).toBe('ul1');
    expect(listData.userList[0].list[0].meta.hash).toBe('h1');
  });

  it('formats intervals', () => {
    expect(formatInterval(65)).toBe('01:05');
    expect(formatInterval(3661)).toBe('01:01:01');
    expect(formatInterval(0)).toBeNull();
  });
});
