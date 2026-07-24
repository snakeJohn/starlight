import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine, getDefaultVoiceCommands } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

function message(query: string): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: 'speaker-1',
    device_name: '客厅音箱',
    message: {
      timestamp_ms: Date.now(),
      response: {
        answer: [{ question: query }],
      },
    },
  };
}

function createEngine(commands: VoiceCommand[]) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async () => [{ device_id: 'speaker-1', play_mode: 'order' }]),
    getConfig: vi.fn(async () => ({ interrupt_tts_hint_enabled: false })),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    stopPlay: vi.fn(async () => true),
    textToSpeech: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManager = {
    hasPlaylist: vi.fn(() => true),
    isPlaying: vi.fn(() => true),
    next: vi.fn(async () => true),
    play: vi.fn(async () => true),
    isLastPlayNotFound: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    resumePlayback: vi.fn(async () => true),
    replayCurrent: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    searchPlaylist: vi.fn(() => []),
    findPlaylistByName: vi.fn(() => null),
    findSongByName: vi.fn(async () => null),
    refresh: vi.fn(async () => ({ success: true, playlistCount: 0, songCount: 0 })),
  } as unknown as IndexingManager;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
  );
  engine.setEnabled(true);

  return { engine, playlistManager, minaService, indexingManager };
}

describe('VoiceEngine empty playback commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not skip to next song when play song has no song name', async () => {
    const { engine, playlistManager, minaService, indexingManager } = createEngine([
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
    ]);

    await engine.handleMessage(message('播放歌曲'));

    expect(playlistManager.next).not.toHaveBeenCalled();
    expect(playlistManager.prepareForNewPlayback).not.toHaveBeenCalled();
    expect(minaService.stopPlay).not.toHaveBeenCalled();
    expect(indexingManager.findSongByName).not.toHaveBeenCalled();
  });

  it('does not skip to next song when play playlist has no playlist name and a queue exists', async () => {
    const { engine, playlistManager, minaService, indexingManager } = createEngine([
      { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
    ]);

    await engine.handleMessage(message('播放歌单'));

    expect(playlistManager.next).not.toHaveBeenCalled();
    expect(playlistManager.prepareForNewPlayback).not.toHaveBeenCalled();
    expect(minaService.stopPlay).not.toHaveBeenCalled();
    expect(indexingManager.searchPlaylist).not.toHaveBeenCalled();
  });

  it('treats "闭嘴" as a default stop playback command', async () => {
    const { engine, playlistManager } = createEngine(getDefaultVoiceCommands());

    await engine.handleMessage(message('闭嘴'));

    expect(playlistManager.stop).toHaveBeenCalledTimes(1);
    expect(playlistManager.replayCurrent).not.toHaveBeenCalled();
  });

  it('treats "暂停" as stop even when user commands omit it', async () => {
    // 用户已保存旧版 stop 口令（不含「暂停」），仍应内置识别
    const { engine, playlistManager } = createEngine([
      { type: 'stop', keywords: ['停止播放', '停止'], enabled: true },
      { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
    ]);

    await engine.handleMessage(message('暂停'));

    expect(playlistManager.stop).toHaveBeenCalledTimes(1);
    expect(playlistManager.replayCurrent).not.toHaveBeenCalled();
  });

  it('retries play playlist when playlist id is stale', async () => {
    const { engine, playlistManager, indexingManager, minaService } = createEngine([
      { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
    ]);

    playlistManager.hasPlaylist = vi.fn(() => false);
    playlistManager.isPlaying = vi.fn(() => false);
    playlistManager.play = vi.fn(async () => false);
    playlistManager.isLastPlayNotFound = vi.fn(() => true);
    indexingManager.findPlaylistByName = vi.fn()
      .mockReturnValueOnce({ id: 1, name: '喜欢' })
      .mockReturnValueOnce({ id: 99, name: '喜欢' });
    indexingManager.refresh = vi.fn(async () => ({ success: true, playlistCount: 1, songCount: 10 }));
    indexingManager.isIndexReady = vi.fn(() => true);

    // 第二次 play 成功
    (playlistManager.play as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await engine.handleMessage(message('播放歌单喜欢'));

    expect(playlistManager.play).toHaveBeenCalledTimes(2);
    expect(indexingManager.refresh).toHaveBeenCalled();
    expect(minaService.textToSpeech).not.toHaveBeenCalled();
  });
});
