import { describe, expect, it } from 'vitest';
import {
  mapListDataToPlaylists,
  mapLxMusicToSong,
  mapPlaylistsToListData,
  parseIntervalSeconds,
  parseLxListPayload,
} from '../../src/lx_sync/mapper';
import type { LxListData, LxMusicInfo } from '../../src/lx_sync/types';
import type { CustomPlaylist } from '../../src/custom_playlists/types';

const kwSong: LxMusicInfo = {
  id: 'kw_1',
  name: '稻花香',
  singer: '周杰伦',
  source: 'kw',
  interval: '03:43',
  meta: {
    songId: '12345',
    albumName: '魔杰座',
    picUrl: 'https://img.test/cover.jpg',
  },
};

const kgSong: LxMusicInfo = {
  id: 'kg_1',
  name: '为你',
  singer: '图图',
  source: 'kg',
  interval: '04:20',
  meta: {
    songId: 'kg-song',
    hash: 'abc123hash',
    albumName: '为你',
    picUrl: null,
  },
};

const localSong: LxMusicInfo = {
  id: 'local_1',
  name: '本地曲',
  singer: '未知',
  source: 'local',
  interval: '01:02:03',
  meta: {
    albumName: '本地专辑',
  },
};

describe('lx_sync mapper', () => {
  it('parses mm:ss and hh:mm:ss intervals', () => {
    expect(parseIntervalSeconds('03:43')).toBe(223);
    expect(parseIntervalSeconds('01:02:03')).toBe(3723);
    expect(parseIntervalSeconds(null)).toBe(0);
    expect(parseIntervalSeconds('bad')).toBe(0);
  });

  it('parses list payload envelopes', () => {
    const data = parseLxListPayload({ data: { defaultList: [], loveList: [], userList: [] } });
    expect(data.userList).toEqual([]);
  });

  it('maps online platform songs with source_data', () => {
    const song = mapLxMusicToSong(kwSong);
    expect(song).toMatchObject({
      title: '稻花香',
      artist: '周杰伦',
      album: '魔杰座',
      duration: 223,
      cover_url: 'https://img.test/cover.jpg',
      source_name: '酷我',
      stable_key: 'lx:kw:kw_1',
    });
    expect(song.source_data).toEqual({
      platform: 'kw',
      quality: '320k',
      songInfo: expect.objectContaining({
        source: 'kw',
        name: '稻花香',
        singer: '周杰伦',
      }),
    });
  });

  it('maps list data into love/default/user playlists', () => {
    const data: LxListData = {
      loveList: [kwSong],
      defaultList: [localSong],
      userList: [
        {
          id: 'u1',
          name: '古风',
          list: [kgSong],
        },
      ],
    };

    const playlists = mapListDataToPlaylists(data);
    expect(playlists).toHaveLength(3);
    expect(playlists[0]).toMatchObject({ name: '我喜欢', lxListId: 'lx:love', kind: 'love' });
    expect(playlists[1]).toMatchObject({ name: '默认列表', lxListId: 'lx:default', kind: 'default' });
    expect(playlists[2]).toMatchObject({ name: '古风', lxListId: 'lx:user:u1', kind: 'user' });
    expect(playlists[2]?.songs).toHaveLength(1);
  });

  it('skips empty love/default/user lists by default', () => {
    const playlists = mapListDataToPlaylists({
      loveList: [],
      defaultList: [],
      userList: [{ id: 'empty', name: '空歌单', list: [] }],
    });
    expect(playlists).toEqual([]);
  });

  it('includeEmpty keeps empty lists for protocol snapshot replace', () => {
    const playlists = mapListDataToPlaylists(
      {
        loveList: [],
        defaultList: [],
        userList: [{ id: 'empty', name: '空歌单', list: [] }],
      },
      { includeEmpty: true },
    );
    expect(playlists).toHaveLength(3);
    expect(playlists.every((p) => p.songs.length === 0)).toBe(true);
  });

  it('export maps fixed lists only via sourceListId', () => {
    const playlists: CustomPlaylist[] = [
      {
        id: 'a',
        name: '我喜欢',
        cover_url: '',
        imported_at: '',
        updated_at: '',
        songs: [
          {
            title: '用户',
            artist: 'A',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'u1',
          },
        ],
      },
      {
        id: 'b',
        name: '其他',
        cover_url: '',
        sourceListId: 'lx:love',
        imported_at: '',
        updated_at: '',
        songs: [
          {
            title: 'LX',
            artist: 'B',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'lx1',
            source_data: {
              platform: 'kw',
              quality: '320k',
              songInfo: { source: 'kw', name: 'LX', singer: 'B', album: '', duration: 1 },
            },
          },
        ],
      },
    ];
    const data = mapPlaylistsToListData(playlists);
    expect(data.loveList.map((s) => s.name)).toEqual(['LX']);
    expect(data.userList.some((u) => u.name === '我喜欢')).toBe(true);
  });
});
