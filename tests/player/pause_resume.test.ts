import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { setHostBaseUrl } from '../../src/utils/http';

const song: PlayerSong = {
  id: 1,
  type: 'remote',
  title: '长曲',
  artist: '歌手',
  album: '',
  duration: 120,
  file_path: '',
  url: 'https://audio.test/long.mp3',
  cover_path: '',
  cover_url: '',
  lyric_url: '',
  file_size: 0,
  format: 'mp3',
  bit_rate: 0,
  sample_rate: 0,
  is_live: false,
  cache_hash: '',
};

function createManager() {
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const configManager = {
    getConfig: vi.fn(async () => ({ force_mp3: false, server_host: 'http://songloft.test:18191' })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
  return {
    manager: new PlaylistManager('acc-1', 'dev-1', minaService, configManager),
    minaService,
  };
}

describe('PlaylistManager pause/resume progress', () => {
  beforeEach(() => {
    setHostBaseUrl('http://songloft.test:18191');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not count pause wall-clock time against remaining after long pause', async () => {
    const { manager, minaService } = createManager();
    await expect(manager.playStandalone([{ ...song }], 0, 'order')).resolves.toBe(true);

    // Play 30s then pause.
    vi.advanceTimersByTime(30_000);
    await manager.pause();
    expect(manager.getStatus().state).toBe('paused');
    expect(manager.getPosition()).toBeCloseTo(30, 0);

    // Pause for longer than remaining duration (100s > 90s remaining).
    vi.advanceTimersByTime(100_000);
    expect(manager.getPosition()).toBeCloseTo(30, 0);

    await expect(manager.resumePlayback()).resolves.toBe(true);
    expect(manager.getStatus().state).toBe('playing');
    expect(manager.getPosition()).toBeCloseTo(30, 0);
    expect(minaService.resumePlay).toHaveBeenCalled();

    // Still 90s left — advance 80s should still be playing, not stuck without timer.
    vi.advanceTimersByTime(80_000);
    expect(manager.getPosition()).toBeCloseTo(110, 0);
  });
});
