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
    pausePlayVerified: vi.fn(async () => 'paused' as const),
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

  it('marks a stop-escalated pause as quiet but not directly resumable', async () => {
    const { manager, minaService } = createManager();
    vi.mocked(minaService.pausePlayVerified).mockResolvedValue('stopped');

    await manager.playStandalone([{ ...song }], 0, 'order');
    await expect(manager.pause()).resolves.toBe(true);

    expect(manager.getStatus().state).toBe('paused');
    await expect(manager.resumePlayback()).resolves.toBe(false);
    expect(minaService.resumePlay).not.toHaveBeenCalled();
  });

  it('blocks direct resume while pause verification has a stop in flight', async () => {
    const { manager, minaService } = createManager();
    let finishStop!: (result: 'stopped') => void;
    const stopInFlight = new Promise<'stopped'>(resolve => {
      finishStop = resolve;
    });
    vi.mocked(minaService.pausePlayVerified).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 1_400));
      return stopInFlight;
    });

    await manager.playStandalone([{ ...song }], 0, 'order');
    const pendingPause = manager.pause();
    await vi.advanceTimersByTimeAsync(1_400);

    const resumed = await manager.resumePlayback();
    finishStop('stopped');
    await pendingPause;

    expect(resumed).toBe(false);
    expect(minaService.resumePlay).not.toHaveBeenCalled();
  });

  it('keeps direct resume blocked until all overlapping pause verifications settle', async () => {
    const { manager, minaService } = createManager();
    let finishFirst!: (result: 'paused') => void;
    let finishSecond!: (result: 'paused') => void;
    const firstVerification = new Promise<'paused'>(resolve => {
      finishFirst = resolve;
    });
    const secondVerification = new Promise<'paused'>(resolve => {
      finishSecond = resolve;
    });
    vi.mocked(minaService.pausePlayVerified)
      .mockReturnValueOnce(firstVerification)
      .mockReturnValueOnce(secondVerification);

    await manager.playStandalone([{ ...song }], 0, 'order');
    const firstPause = manager.pause();
    const secondPause = manager.pause();

    finishFirst('paused');
    await firstPause;
    await expect(manager.resumePlayback()).resolves.toBe(false);

    finishSecond('paused');
    await secondPause;
    await expect(manager.resumePlayback()).resolves.toBe(true);
    expect(minaService.resumePlay).toHaveBeenCalledTimes(1);
  });

  it('returns false and preserves truthful failure when verified pause fails', async () => {
    const { manager, minaService } = createManager();
    vi.mocked(minaService.pausePlayVerified).mockResolvedValue('failed');

    await manager.playStandalone([{ ...song }], 0, 'order');
    vi.advanceTimersByTime(30_000);
    await expect(manager.pause()).resolves.toBe(false);

    expect(manager.getStatus().state).toBe('paused');
    expect(manager.getPosition()).toBeCloseTo(30, 0);
  });

  it('clears the hard-stop marker only after replay accepts a new URL', async () => {
    const { manager, minaService } = createManager();
    vi.mocked(minaService.pausePlayVerified).mockResolvedValue('stopped');

    await manager.playStandalone([{ ...song }], 0, 'order');
    await manager.pause();
    await expect(manager.resumePlayback()).resolves.toBe(false);

    vi.mocked(minaService.playURL).mockResolvedValueOnce(false);
    await expect(manager.replayCurrent()).resolves.toBe(false);
    await expect(manager.resumePlayback()).resolves.toBe(false);
    expect(minaService.resumePlay).not.toHaveBeenCalled();

    vi.mocked(minaService.playURL).mockResolvedValueOnce(true);
    await expect(manager.replayCurrent()).resolves.toBe(true);
    await expect(manager.resumePlayback()).resolves.toBe(true);
    expect(minaService.resumePlay).toHaveBeenCalledTimes(1);
  });
});
