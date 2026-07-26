import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SearchResultSong } from '../../src/music/types';
import { setHostBaseUrl } from '../../src/utils/http';

const HOST = 'http://songloft.test:18191';

function sourceSong(id: string, title: string): SearchResultSong {
  return {
    title,
    artist: '歌手',
    album: '专辑',
    duration: 100,
    cover_url: '',
    source_data: {
      platform: 'kw' as SearchResultSong['source_data']['platform'],
      quality: 'flac' as SearchResultSong['source_data']['quality'],
      songInfo: { songmid: id } as unknown as SearchResultSong['source_data']['songInfo'],
    },
  };
}

function fakeMina(): MinaService {
  return {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
}

function fakeConfig(): ConfigManager {
  return {
    getConfig: vi.fn(async () => ({ force_mp3: false, server_host: HOST, prefetch_next_song: false })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
}

/**
 * 组合测试：真实 BridgeService + 真实 PlaylistManagerMap 一起跑。
 *
 * 两边各自单测都能过，却掩盖了「两套歌词补全并存」——只有把真实调用链接起来
 * 才会暴露重复解析。计数点放在最终出口 resolveMusicLyric 上：只数注入的
 * resolver 的话，另一套实现直接调音源解析就绕开断言了。
 */
describe('lyric fill ownership (BridgeService + PlaylistManager combined)', () => {
  beforeEach(() => {
    vi.resetModules();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
  });

  afterEach(() => {
    vi.doUnmock('../../src/music/platforms/lyrics');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resolves each song lyric at most once when playing a real songlist', async () => {
    const platformLyricCalls: string[] = [];
    vi.doMock('../../src/music/platforms/lyrics', () => ({
      resolveMusicLyric: vi.fn(async (_platform: string, info: Record<string, unknown>) => {
        platformLyricCalls.push(String(info?.songmid ?? '?'));
        return { lyric: '[00:00.000]x' };
      }),
    }));

    const { BridgeService, resolvePlayerSongLyric } = await import('../../src/bridge/service');
    const { PlaylistManagerMap } = await import('../../src/player/manager');

    const minaService = fakeMina();
    const playlistManagerMap = new PlaylistManagerMap(minaService, fakeConfig());
    playlistManagerMap.setDynamicPlaylistOptions({
      songLyricResolver: (song) => resolvePlayerSongLyric(song),
    });

    // 直连音源：没有宿主歌曲 ID，只能靠内联歌词，正是会被重复补全的那一类
    const runtimes = {
      getMusicUrl: vi.fn(async () => 'https://cdn.example.com/a.mp3'),
      getLastMusicUrlAttempt: () => ({ attemptedSources: 1, lastFailure: null }),
    } as unknown as RuntimeManager;
    const platforms = { all: () => [], get: () => undefined } as unknown as PlatformRegistry;

    const bridge = new BridgeService(platforms, runtimes, minaService, playlistManagerMap);
    await bridge.playSonglistOnSpeaker('acc', 'dev', [
      sourceSong('1', '第一首'),
      sourceSong('2', '第二首'),
    ]);

    // 让 fire-and-forget 的补全结算
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const counts = new Map<string, number>();
    for (const id of platformLyricCalls) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      expect(count, `songmid ${id} 被解析了 ${count} 次（应为 1）`).toBe(1);
    }
    // 至少确实补过，否则这条断言会因为「一次都没调」而空转通过
    expect(platformLyricCalls.length).toBeGreaterThan(0);

    playlistManagerMap.cleanup();
  });

  it('resolvePlayerSongLyric returns empty instead of throwing when a song has no source_data', async () => {
    const { resolvePlayerSongLyric } = await import('../../src/bridge/service');
    const bare = { title: 'x', artist: 'y' } as unknown as PlayerSong;
    await expect(resolvePlayerSongLyric(bare)).resolves.toBe('');
  });
});

describe('pausing the speaker stops the auto-advance timer', () => {
  beforeEach(() => {
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const song = (id: number, title: string): PlayerSong => ({
    id, type: 'local', title, artist: 'a', album: '', duration: 10,
    file_path: '', url: `/api/v1/songs/${id}/play`, cover_path: '', cover_url: '',
    lyric_url: '', file_size: 0, format: 'mp3', bit_rate: 0, sample_rate: 0,
    is_live: false, cache_hash: '',
  });

  it('pausing only the physical device still auto-advances — the manager must be paused too', async () => {
    // 这条固定的是「为什么 /mina/pause 必须经过 PlaylistManager」。
    // 只调 minaService.pausePlay()（修复前 /mina/pause 的行为）时，管理器仍是
    // playing、切歌定时器仍在跑，A 播完就会把 B 推给音箱——切到浏览器后音箱
    // 自己又响了。断言这种用法确实会推进，这样一旦有人把 handler 改回只停设备，
    // 下面那条 expect 就会失败。
    vi.useFakeTimers();
    try {
      const minaService = fakeMina();
      const manager = new PlaylistManager('acc', 'dev', minaService, fakeConfig());
      await manager.playStandalone([song(1, 'A'), song(2, 'B')], 0, 'order');
      expect(minaService.playURL).toHaveBeenCalledTimes(1);

      // 只停物理设备，不碰管理器
      await minaService.pausePlay('acc', 'dev');
      await vi.advanceTimersByTimeAsync(20_000);

      expect(minaService.playURL).toHaveBeenCalledTimes(2);
      manager.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not advance to the next track after the manager is paused', async () => {
    vi.useFakeTimers();
    try {
      const minaService = fakeMina();
      const manager = new PlaylistManager('acc', 'dev', minaService, fakeConfig());
      await manager.playStandalone([song(1, 'A'), song(2, 'B')], 0, 'order');
      expect(minaService.playURL).toHaveBeenCalledTimes(1);

      // 经管理器暂停：状态转 paused 且定时器被清除，两道保险都到位
      await manager.pause();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(minaService.playURL).toHaveBeenCalledTimes(1);
      manager.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
