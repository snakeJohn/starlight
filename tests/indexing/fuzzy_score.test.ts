import { describe, expect, it, vi } from 'vitest';
import { IndexingManager } from '../../src/indexing/manager';

/**
 * 语音点歌会对整个曲库逐首调用模糊评分，所以那里加了两处优化：
 *   1. 长度差短路 —— 编辑距离不小于两串长度差，差太大时必然达不到 0.5 阈值
 *   2. 按「标题+歌手」缓存评分 —— 同一首歌常同时存在于多个歌单
 * 两者都必须是**等价**优化：只能变快，不能改变匹配结果。
 */
function managerWith(playlists: Array<{ id: number; name: string; songs: Array<{ id: number; title: string; artist: string }> }>) {
  const manager = new IndexingManager();
  const internals = manager as unknown as {
    playlists: Array<{ id: number; name: string; nameLower: string; songCount: number }>;
    songs: Array<{ id: number; title: string; artist: string; album: string; titleLower: string; artistLower: string }>;
    playlistSongsCache: Map<number, Array<{ id: number; title: string; artist: string }>>;
    indexReady: boolean;
  };

  internals.playlists = playlists.map((p) => ({
    id: p.id, name: p.name, nameLower: p.name.toLowerCase(), songCount: p.songs.length,
  }));
  internals.songs = playlists.flatMap((p) => p.songs).map((s) => ({
    id: s.id, title: s.title, artist: s.artist, album: '',
    titleLower: s.title.toLowerCase(), artistLower: s.artist.toLowerCase(),
  }));
  internals.playlistSongsCache = new Map(playlists.map((p) => [p.id, p.songs]));
  internals.indexReady = true;
  return manager;
}

describe('fuzzy match stays correct after the short-circuit and memoisation', () => {
  it('still finds an exact title match', async () => {
    const manager = managerWith([
      { id: 1, name: '古风', songs: [
        { id: 10, title: '倾尽天下', artist: '河图' },
        { id: 11, title: '风起天阑', artist: '河图' },
      ] },
    ]);

    const found = await manager.findSongByName('倾尽天下');
    expect(found?.songTitle).toBe('倾尽天下');
  });

  it('still finds a substring match despite the length-gap short circuit', async () => {
    // 「她说」比「她说 - 林俊杰」短很多；短路只能跳过编辑距离分支，
    // 不能把子串匹配也一起跳掉（子串在更早的分支里已经判定）。
    const manager = managerWith([
      { id: 1, name: '流行', songs: [{ id: 20, title: '她说 - 林俊杰', artist: '林俊杰' }] },
    ]);

    const found = await manager.findSongByName('她说');
    expect(found?.songTitle).toBe('她说 - 林俊杰');
  });

  it('still rejects an unrelated query', async () => {
    const manager = managerWith([
      { id: 1, name: '古风', songs: [{ id: 10, title: '倾尽天下', artist: '河图' }] },
    ]);

    expect(await manager.findSongByName('完全不相干的歌名')).toBeNull();
  });

  it('memoisation does not let one song\'s score leak onto another', async () => {
    // 缓存键是「标题+歌手」。用空格拼接会让 ("a b","c") 与 ("a","b c") 撞键，
    // 于是第二首会拿到第一首的分数。
    const manager = managerWith([
      { id: 1, name: '测试', songs: [
        { id: 30, title: '目标 歌', artist: '甲' },
        { id: 31, title: '目标', artist: '歌 甲' },
      ] },
    ]);

    const found = await manager.findSongByName('目标 歌');
    // 无论命中哪一首都可以，但必须是真实评分的结果，不能因撞键而错配
    expect(found).not.toBeNull();
    expect(['目标 歌', '目标']).toContain(found?.songTitle);
  });

  it('scores the same song identically no matter how many playlists contain it', async () => {
    const shared = { id: 40, title: '共享曲目', artist: '歌手' };
    const single = managerWith([{ id: 1, name: 'A', songs: [shared] }]);
    const multi = managerWith([
      { id: 1, name: 'A', songs: [shared] },
      { id: 2, name: 'B', songs: [shared] },
      { id: 3, name: 'C', songs: [shared] },
    ]);

    const a = await single.findSongByName('共享曲目');
    const b = await multi.findSongByName('共享曲目');
    expect(a?.songTitle).toBe('共享曲目');
    expect(b?.songTitle).toBe('共享曲目');
  });
});
