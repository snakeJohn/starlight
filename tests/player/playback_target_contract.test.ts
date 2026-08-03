import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';

const root = resolve(process.cwd());

function song(id: number): PlayerSong {
  return {
    id,
    type: 'local',
    title: `Song ${id}`,
    artist: 'Artist',
    album: '',
    duration: 180,
    file_path: '',
    url: `/api/v1/songs/${id}/play`,
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
}

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

describe('PlaylistManager song-id playlist targeting', () => {
  beforeEach(() => {
    songloft.playlists.getSongs = vi.fn(async () => []);
  });

  it('selects the requested song id from the freshly loaded playlist order', async () => {
    const { manager, minaService } = createManager();
    songloft.playlists.getSongs = vi.fn(async () => [song(22), song(21), song(23)]) as typeof songloft.playlists.getSongs;

    await expect(manager.playPlaylistFromSong(9, 21, 'order', 0)).resolves.toBe(true);

    expect(manager.getStatus()).toMatchObject({ playlist_id: 9, current_index: 1 });
    expect(minaService.playURL).toHaveBeenCalledWith(
      'acc-1', 'dev-1', expect.stringContaining('/songs/21/play'), expect.any(Object),
    );
  });

  it('falls back to the validated request index when song id is absent from the fresh list', async () => {
    const { manager } = createManager();
    songloft.playlists.getSongs = vi.fn(async () => [song(10), song(11), song(12)]) as typeof songloft.playlists.getSongs;

    await expect(manager.playPlaylistFromSong(9, 99, 'order', 2)).resolves.toBe(true);

    expect(manager.getStatus().current_index).toBe(2);
  });
});

describe('playback target UI contract', () => {
  it('exposes browser/speaker selector distinct from play-mode controls', () => {
    const html = readFileSync(resolve(root, 'static/index.html'), 'utf8');
    expect(html).toContain('data-action="playback-target-select"');
    expect(html).toContain('data-target="browser"');
    expect(html).toContain('data-target="speaker"');
    expect(html).toContain('data-role="playback-target-hint"');
    // Play mode remains a separate control surface.
    expect(html).toContain('data-action="speaker-player-mode-option"');
  });

  it('routes controls through selected playback target modules', () => {
    const player = readFileSync(resolve(root, 'static/js/speaker_modules/player.js'), 'utf8');
    const target = readFileSync(resolve(root, 'static/js/speaker_modules/playback_target.js'), 'utf8');
    const browser = readFileSync(resolve(root, 'static/js/speaker_modules/browser_player.js'), 'utf8');
    const music = readFileSync(resolve(root, 'static/js/music.js'), 'utf8');

    expect(target).toContain('starlight.playbackTarget');
    expect(target).toContain('已切换到');
    expect(target).toContain('下次播放将使用');
    expect(browser).toContain('new Audio');
    expect(browser).toContain('/bridge/preview-url');
    expect(player).toContain('getSelectedPlaybackTarget');
    expect(player).toContain('browserPlayerAction');
    expect(player).toContain('handoffBrowserQueueToSpeaker');
    expect(player).toContain('handoffSpeakerQueueToBrowser');
    expect(player).toContain('retained_from_browser');
    expect(player).toContain('retained_from_speaker');
    expect(browser).toContain('getBrowserQueueSnapshot');
    expect(browser).toContain('pauseBrowserPlayback');
    expect(music).toContain("getSelectedPlaybackTarget() === 'browser'");
  });
});
