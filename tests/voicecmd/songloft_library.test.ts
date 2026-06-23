import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { CustomPlaylistService } from '../../src/custom_playlists/service';
import type { CustomPlaylist } from '../../src/custom_playlists/types';
import type { IndexingManager, IndexedPlaylist } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

const commands: VoiceCommand[] = [
  { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
  { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
];

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

function createCustomPlaylist(name: string): CustomPlaylist {
  return {
    id: `custom_${name}`,
    name,
    cover_url: '',
    imported_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    songs: [],
  };
}

function createIndexedPlaylist(id: number, name: string): IndexedPlaylist {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    songCount: 1,
  };
}

function testSongloft(): any {
  return (globalThis as typeof globalThis & { songloft: any }).songloft;
}

function createEngine(options?: {
  customPlaylists?: CustomPlaylist[];
  indexedPlaylist?: IndexedPlaylist | null;
  indexedSongLocation?: Awaited<ReturnType<IndexingManager['findSongByName']>>;
  standaloneSong?: Awaited<ReturnType<IndexingManager['findStandaloneSongByName']>>;
  externalSearchEnabled?: boolean;
  bridgeService?: {
    externalSearch: ReturnType<typeof vi.fn>;
    playOnSpeaker: ReturnType<typeof vi.fn>;
  };
}) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getConfig: vi.fn(async () => ({
      interrupt_tts_hint_enabled: false,
      interrupt_tts_hint_text: '',
      external_search_enabled: options?.externalSearchEnabled ?? false,
      external_search_url: '',
      external_search_token: '',
      server_host: '',
      force_mp3: false,
    })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async () => [{ device_id: 'speaker-1', play_mode: 'order' }]),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    stopPlay: vi.fn(async () => true),
    textToSpeech: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManager = {
    hasPlaylist: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    play: vi.fn(async () => true),
    playStandalone: vi.fn(async () => true),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    refresh: vi.fn(async () => ({ success: true, songCount: 0, playlistCount: 0 })),
    searchPlaylist: vi.fn(() => []),
    findPlaylistByName: vi.fn(() => options?.indexedPlaylist ?? null),
    findSongByName: vi.fn(async () => options?.indexedSongLocation ?? null),
    findStandaloneSongByName: vi.fn(async () => options?.standaloneSong ?? null),
  } as unknown as IndexingManager;
  const customPlaylistService = {
    list: vi.fn(async () => options?.customPlaylists ?? []),
    create: vi.fn(),
    addSong: vi.fn(),
  } as unknown as CustomPlaylistService;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
    undefined,
    options?.bridgeService as never,
    customPlaylistService,
  );
  engine.setEnabled(true);

  return {
    engine,
    customPlaylistService,
    indexingManager,
    minaService,
    playlistManager,
    playlistManagerMap,
  };
}

describe('VoiceEngine Songloft library matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const songloft = testSongloft();
    songloft.playlists.list = vi.fn(async () => []);
    songloft.playlists.getSongs = vi.fn(async () => []);
    songloft.songs.list = vi.fn(async () => []);
  });

  it('plays a custom playlist before a same-named Songloft playlist', async () => {
    const songloft = testSongloft();
    songloft.playlists.list = vi.fn(async () => [{ id: 501, name: '晚安' }]);
    const { engine, playlistManager } = createEngine({
      customPlaylists: [createCustomPlaylist('晚安')],
      indexedPlaylist: createIndexedPlaylist(501, '晚安'),
    });

    await engine.handleMessage(message('播放歌单 晚安'));

    expect(playlistManager.play).toHaveBeenCalledWith(-100000, 0, 'order');
    expect(playlistManager.play).not.toHaveBeenCalledWith(501, expect.any(Number), expect.any(String));
    expect(songloft.playlists.getSongs).not.toHaveBeenCalled();
  });

  it('plays a matched Songloft playlist as a standalone speaker queue when no custom playlist matches', async () => {
    const songloft = testSongloft();
    songloft.playlists.list = vi.fn(async () => [{ id: 301, name: '雨夜' }]);
    songloft.playlists.getSongs = vi.fn(async () => [
      {
        id: 44,
        type: 'remote',
        title: '雨一直下',
        artist: '张宇',
        album: '雨一直下',
        duration: 260,
        url: 'https://audio.test/rain.mp3',
      },
    ]);
    const { engine, playlistManager, minaService } = createEngine({
      customPlaylists: [],
      indexedPlaylist: null,
    });

    await engine.handleMessage(message('播放歌单 雨夜'));

    expect(songloft.playlists.getSongs).toHaveBeenCalledWith(301, expect.any(Object));
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 44,
        type: 'remote',
        title: '雨一直下',
        artist: '张宇',
        url: 'https://audio.test/rain.mp3',
      }),
    ], 0, 'order');
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌单：雨夜');
  });

  it('plays a local Songloft library song before a remote match with the same title', async () => {
    const songloft = testSongloft();
    songloft.songs.list = vi.fn(async () => [
      {
        id: 73,
        type: 'remote',
        title: '小幸运',
        artist: '远程歌手',
        album: '',
        duration: 240,
        url: 'https://audio.test/remote-lucky.mp3',
      },
      {
        id: 72,
        type: 'local',
        title: '小幸运',
        artist: '本地歌手',
        album: '',
        duration: 241,
        url: '',
      },
    ]);
    const { engine, playlistManager, minaService } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
    });

    await engine.handleMessage(message('播放歌曲 小幸运'));

    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 72,
        type: 'local',
        title: '小幸运',
        artist: '本地歌手',
        url: 'http://127.0.0.1:18191/api/v1/songs/72/play?access_token=test-plugin-token',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：小幸运');
  });

  it('keeps the online search fallback when Songloft library songs miss', async () => {
    const bridgeService = {
      externalSearch: vi.fn(async () => ({
        title: '深海',
        artist: '凤凰传奇',
        album: '',
        duration: 200,
        cover_url: '',
        source_data: { platform: 'kg', quality: '320k', songInfo: { hash: 'hash-1' } },
      })),
      playOnSpeaker: vi.fn(async () => ({ url: 'https://audio.test/deep-sea.mp3' })),
    };
    const { engine, minaService } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      externalSearchEnabled: true,
      bridgeService,
    });

    await engine.handleMessage(message('播放歌曲 深海'));

    expect(bridgeService.externalSearch).toHaveBeenCalledWith('深海');
    expect(bridgeService.playOnSpeaker).toHaveBeenCalledWith('acc-1', 'speaker-1', expect.objectContaining({ title: '深海' }));
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：深海');
  });
});
