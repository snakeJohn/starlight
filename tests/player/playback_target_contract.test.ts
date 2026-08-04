import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { URLBuilder } from '../../src/player/url_builder';
import { setHostBaseUrl } from '../../src/utils/http';

const root = resolve(process.cwd());

function song(id: number, type = 'local'): PlayerSong {
  return {
    id,
    type,
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

function createManager(config = { force_mp3: false, radio_force_mp3: false, server_host: 'http://songloft.test:18191' }) {
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const configManager = {
    getConfig: vi.fn(async () => config),
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
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'token';
    setHostBaseUrl('http://songloft.test:18191');
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

  it('passes radio MP3 transcoding URLs through the speaker lifecycle', async () => {
    const { manager, minaService } = createManager({
      force_mp3: false,
      radio_force_mp3: true,
      server_host: 'http://songloft.test:18191',
    });
    songloft.playlists.getSongs = vi.fn(async () => [song(7, 'radio')]) as typeof songloft.playlists.getSongs;

    await expect(manager.playPlaylistFromSong(9, 7)).resolves.toBe(true);

    expect(minaService.playURL).toHaveBeenCalledWith(
      'acc-1',
      'dev-1',
      expect.stringContaining('access_token=token&radio_transcode=mp3'),
      expect.any(Object),
    );
  });

  it('does not let an older playlist load overwrite a newer playback queue', async () => {
    const { manager } = createManager();
    let resolveFirst!: (songs: PlayerSong[]) => void;
    let resolveSecond!: (songs: PlayerSong[]) => void;
    songloft.playlists.getSongs = vi.fn()
      .mockImplementationOnce(() => new Promise<PlayerSong[]>(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<PlayerSong[]>(resolve => { resolveSecond = resolve; })) as typeof songloft.playlists.getSongs;

    const firstPlay = manager.play(9, 0, 'order');
    const secondPlay = manager.play(10, 0, 'order');

    resolveSecond([song(20)]);
    await expect(secondPlay).resolves.toBe(true);

    resolveFirst([song(10)]);
    await expect(firstPlay).resolves.toBe(false);

    expect(manager.getStatus()).toMatchObject({ playlist_id: 10, current_index: 0 });
    expect(manager.getCurrentSong()?.id).toBe(20);
  });
});

describe('URLBuilder radio MP3 transcoding', () => {
  beforeEach(() => {
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'token';
    setHostBaseUrl('http://songloft.test:18191');
  });

  it('adds radio transcoding after the access token only when enabled for radio songs', async () => {
    const radioSong = { id: 7, type: 'radio', url: '/api/v1/songs/7/play' };
    const localSong = { id: 8, type: 'local', url: '/api/v1/songs/8/play' };

    await expect(URLBuilder.buildSongURL(radioSong, { radioForceMp3: true }))
      .resolves.toBe('http://songloft.test:18191/api/v1/songs/7/play?access_token=token&radio_transcode=mp3');
    await expect(URLBuilder.buildSongURL(radioSong, { radioForceMp3: false }))
      .resolves.toBe('http://songloft.test:18191/api/v1/songs/7/play?access_token=token');
    await expect(URLBuilder.buildSongURL(localSong, { radioForceMp3: true }))
      .resolves.not.toContain('radio_transcode');
    await expect(URLBuilder.buildSongURL(radioSong, { forceMp3: true, radioForceMp3: true }))
      .resolves.toBe('http://songloft.test:18191/api/v1/songs/7/play?access_token=token&format=mp3&radio_transcode=mp3');
  });

  it('leaves absolute external radio URLs unchanged', async () => {
    const externalRadio = { id: 7, type: 'radio', url: 'https://radio.example.test/live.mp3?station=7' };

    await expect(URLBuilder.buildSongURL(externalRadio, { forceMp3: true, radioForceMp3: true }))
      .resolves.toBe('https://radio.example.test/live.mp3?station=7');
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
