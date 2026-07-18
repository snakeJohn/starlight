import { describe, expect, it } from 'vitest';
import {
  mapListDataToPlaylists,
  mapLxMusicToSong,
  mergeSongsByStableKey,
  parseIntervalSeconds,
  parseLxListPayload,
  summarizeListData,
} from '../../src/lx_sync/mapper';
import type { LxListData, LxMusicInfo } from '../../src/lx_sync/types';

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
  name: '为龙',
  singer: '河图',
  source: 'kg',
  interval: '04:20',
  meta: {
    songId: 'kg-song',
    hash: 'abc123hash',
    albumName: '为龙',
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
        musicId: '12345',
        songId: '12345',
      }),
    });
  });

  it('maps kg hash into songInfo', () => {
    const song = mapLxMusicToSong(kgSong);
    expect(song.source_data?.songInfo.hash).toBe('abc123hash');
    expect(song.stable_key).toBe('lx:kg:kg_1');
  });

  it('maps local songs without platform source_data', () => {
    const song = mapLxMusicToSong(localSong);
    expect(song.source_data).toBeUndefined();
    expect(song.duration).toBe(3723);
    expect(song.stable_key).toBe('lx:local:local_1');
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

    const withoutDefault = mapListDataToPlaylists(data, { importDefaultList: false });
    expect(withoutDefault).toHaveLength(2);
    expect(withoutDefault.find((p) => p.kind === 'default')).toBeUndefined();
  });

  it('summarizes preview counts', () => {
    const summary = summarizeListData({
      loveList: [kwSong, kgSong],
      defaultList: [],
      userList: [],
    });
    expect(summary[0]).toMatchObject({ name: '我喜欢', songCount: 2, kind: 'love' });
  });

  it('merges songs by stable_key', () => {
    const a = mapLxMusicToSong(kwSong);
    const b = mapLxMusicToSong(kgSong);
    const updated = { ...a, title: '稻花香(改)' };
    const merged = mergeSongsByStableKey([a], [updated, b]);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.stable_key === a.stable_key)?.title).toBe('稻花香(改)');
  });
});
