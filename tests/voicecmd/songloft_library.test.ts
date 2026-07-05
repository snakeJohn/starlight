import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { CustomPlaylistService } from '../../src/custom_playlists/service';
import type { CustomPlaylist } from '../../src/custom_playlists/types';
import type { IndexingManager, IndexedPlaylist } from '../../src/indexing/manager';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { SearchResultSong } from '../../src/music/types';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

const commands: VoiceCommand[] = [
  { type: 'add_song_to_playlist', keywords: ['加入歌单'], enabled: true },
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

function createSearchResultSong(overrides?: Partial<SearchResultSong>): SearchResultSong {
  return {
    title: '宿敌',
    artist: '许嵩',
    album: '寻雾启示',
    duration: 260,
    cover_url: '',
    source_data: {
      platform: 'tx',
      quality: '320k',
      songInfo: {
        source: 'tx',
        name: '宿敌',
        singer: '许嵩',
        album: '寻雾启示',
        duration: 260,
        songmid: 'song-mid-1',
      },
    },
    ...overrides,
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
  indexReady?: boolean;
  refreshResult?: { success: boolean; songCount: number; playlistCount: number };
  externalSearchEnabled?: boolean;
  bridgeService?: {
    resolveSearchSong?: ReturnType<typeof vi.fn>;
    externalSearch?: ReturnType<typeof vi.fn>;
    playOnSpeaker?: ReturnType<typeof vi.fn>;
  };
  downloadService?: {
    downloadSong: ReturnType<typeof vi.fn>;
  };
  platforms?: PlatformRegistry;
  commands?: VoiceCommand[];
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
    getVoiceCommands: vi.fn(async () => options?.commands ?? commands),
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
    isPlaying: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    play: vi.fn(async () => true),
    playStandalone: vi.fn(async () => true),
    setPlayMode: vi.fn(async () => undefined),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => options?.indexReady ?? true),
    refresh: vi.fn(async () => options?.refreshResult ?? { success: true, songCount: 0, playlistCount: 0 }),
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
  const platforms = options?.platforms ?? {
    all: vi.fn(() => []),
    get: vi.fn(() => null),
  } as unknown as PlatformRegistry;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
    undefined,
    options?.bridgeService as never,
    customPlaylistService,
    platforms,
  );
  (engine as any).bridgeService = options?.bridgeService;
  (engine as any).downloadService = options?.downloadService;
  engine.setEnabled(true);

  return {
    engine,
    customPlaylistService,
    indexingManager,
    minaService,
    playlistManager,
    playlistManagerMap,
    platforms,
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

  it('plays a matched Songloft playlist through the playlist manager when no custom playlist matches', async () => {
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

    expect(playlistManager.play).toHaveBeenCalledWith(301, 0, 'order');
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();
    expect(songloft.playlists.getSongs).not.toHaveBeenCalled();
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌单：雨夜');
  });

  it('plays a matched Songloft playlist even when the local index refresh fails', async () => {
    const songloft = testSongloft();
    songloft.playlists.list = vi.fn(async () => [{ id: 1, name: '收藏' }]);
    const { engine, playlistManager, indexingManager } = createEngine({
      customPlaylists: [],
      indexedPlaylist: null,
      indexReady: false,
      refreshResult: { success: false, songCount: 0, playlistCount: 0 },
    });

    await engine.handleMessage(message('播放歌单收藏'));

    expect(songloft.playlists.list).toHaveBeenCalled();
    expect(indexingManager.refresh).not.toHaveBeenCalled();
    expect(playlistManager.play).toHaveBeenCalledWith(1, 0, 'order');
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();
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
        url: '/api/v1/songs/72/play',
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

  it('downloads and plays a searched local Songloft copy when library and index miss', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong();
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => resolvedSong),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 901, status: 'ok', path: 'downloads/xs/sudi.mp3' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    songloft.songs.getById = vi.fn(async () => ({
      id: 901,
      type: 'local',
      title: '宿敌',
      artist: '许嵩',
      album: '寻雾启示',
      duration: 260,
      url: '',
    }));
    const { engine, playlistManager, indexingManager, minaService } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      indexReady: false,
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('播放歌曲 宿敌'));

    expect(bridgeService.resolveSearchSong).toHaveBeenCalledWith('宿敌', '');
    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({ quality: 'flac' }),
    }));
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 901,
        type: 'local',
        title: '宿敌',
        artist: '许嵩',
        url: '/api/v1/songs/901/play',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(indexingManager.refresh).toHaveBeenCalled();
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：宿敌');
  });

  it('uses flac24bit for voice auto-download when the searched song exposes that quality', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong({
      source_data: {
        platform: 'tx',
        quality: '320k',
        songInfo: {
          source: 'tx',
          name: '宿敌',
          singer: '许嵩',
          album: '寻雾启示',
          duration: 260,
          songmid: 'song-mid-1',
          types: [{ type: '320k' }, { type: 'flac' }, { type: 'flac24bit' }],
        },
      },
    });
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => resolvedSong),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 905, status: 'ok', path: 'downloads/xs/sudi.flac' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    songloft.songs.getById = vi.fn(async () => ({
      id: 905,
      type: 'local',
      title: '宿敌',
      artist: '许嵩',
      album: '寻雾启示',
      duration: 260,
      url: '',
    }));
    const { engine } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      indexReady: false,
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('播放歌曲 宿敌'));

    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({
        quality: 'flac24bit',
      }),
    }));
    expect(resolvedSong.source_data.quality).toBe('320k');
  });

  it('falls back to flac for voice auto-download when flac24bit is not exposed', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong({
      source_data: {
        platform: 'tx',
        quality: '320k',
        songInfo: {
          source: 'tx',
          name: '宿敌',
          singer: '许嵩',
          album: '寻雾启示',
          duration: 260,
          songmid: 'song-mid-1',
          types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }],
        },
      },
    });
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => resolvedSong),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 906, status: 'ok', path: 'downloads/xs/sudi.flac' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    songloft.songs.getById = vi.fn(async () => ({
      id: 906,
      type: 'local',
      title: '宿敌',
      artist: '许嵩',
      album: '寻雾启示',
      duration: 260,
      url: '',
    }));
    const { engine } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      indexReady: false,
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('播放歌曲 宿敌'));

    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({
        quality: 'flac',
      }),
    }));
    expect(resolvedSong.source_data.quality).toBe('320k');
  });

  it('treats "播放歌手的歌曲" as a play-song command and searches with artist/title hints', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong();
    const bridgeService = {
      resolveSearchSong: vi.fn(async (title: string, artist: string) => {
        return title === '宿敌' && artist === '许嵩' ? resolvedSong : null;
      }),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 903, status: 'ok', path: 'downloads/xs/sudi.mp3' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    songloft.songs.getById = vi.fn(async () => ({
      id: 903,
      type: 'local',
      title: '宿敌',
      artist: '许嵩',
      album: '寻雾启示',
      duration: 260,
      url: '',
    }));
    const { engine, playlistManager, minaService } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      indexReady: false,
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('播放许嵩的宿敌'));

    expect(bridgeService.resolveSearchSong).toHaveBeenNthCalledWith(1, '许嵩的宿敌', '');
    expect(bridgeService.resolveSearchSong).toHaveBeenNthCalledWith(2, '宿敌', '许嵩');
    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({ quality: 'flac' }),
    }));
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 903,
        type: 'local',
        title: '宿敌',
        artist: '许嵩',
        url: '/api/v1/songs/903/play',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：播放许嵩的宿敌');
  });

  it('treats "播放歌曲名" as a play-song command when the explicit keyword is omitted', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong({
      title: '驾鹤西去',
      artist: '许嵩',
      album: '',
      source_data: {
        platform: 'tx',
        quality: '320k',
        songInfo: {
          source: 'tx',
          name: '驾鹤西去',
          singer: '许嵩',
          album: '',
          duration: 260,
          songmid: 'song-mid-jhxq',
        },
      },
    });
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => resolvedSong),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 904, status: 'ok', path: 'downloads/xs/jhxq.mp3' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    songloft.songs.getById = vi.fn(async () => ({
      id: 904,
      type: 'local',
      title: '驾鹤西去',
      artist: '许嵩',
      album: '',
      duration: 260,
      url: '',
    }));
    const { engine, playlistManager, minaService } = createEngine({
      indexedSongLocation: null,
      standaloneSong: null,
      indexReady: false,
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('播放驾鹤西去'));

    expect(bridgeService.resolveSearchSong).toHaveBeenCalledWith('驾鹤西去', '');
    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({ quality: 'flac' }),
    }));
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 904,
        type: 'local',
        title: '驾鹤西去',
        artist: '许嵩',
        url: '/api/v1/songs/904/play',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：驾鹤西去');
  });

  it('does not let a generic "播放" song keyword steal playlist commands', async () => {
    const songloft = testSongloft();
    songloft.playlists.list = vi.fn(async () => [{ id: 1, name: '收藏' }]);
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => null),
    };
    const { engine, playlistManager, minaService } = createEngine({
      bridgeService,
      indexedPlaylist: null,
      commands: [
        { type: 'play_song', keywords: ['播放'], enabled: true },
        { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
      ],
    });

    await engine.handleMessage(message('播放歌单收藏'));

    expect(bridgeService.resolveSearchSong).not.toHaveBeenCalled();
    expect(playlistManager.play).toHaveBeenCalledWith(1, 0, 'order');
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：歌单收藏');
  });

  it('does not let a generic "播放" song keyword steal playback mode commands', async () => {
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => null),
    };
    const { engine, playlistManager, playlistManagerMap, minaService } = createEngine({
      bridgeService,
      commands: [
        { type: 'play_song', keywords: ['播放'], enabled: true },
        { type: 'set_play_mode', keywords: ['随机播放'], param: 'random', enabled: true },
      ],
    });

    vi.mocked(playlistManagerMap.get).mockReturnValue(playlistManager as never);

    await engine.handleMessage(message('随机播放'));

    expect(bridgeService.resolveSearchSong).not.toHaveBeenCalled();
    expect(playlistManager.setPlayMode).toHaveBeenCalledWith('random');
    expect(minaService.textToSpeech).not.toHaveBeenCalledWith('acc-1', 'speaker-1', '未找到歌曲：随机');
  });

  it('sets once mode from an explicit single-play voice command', async () => {
    const { engine, playlistManager, playlistManagerMap } = createEngine({
      commands: [
        { type: 'set_play_mode', keywords: ['单曲播放'], param: 'once', enabled: true },
      ],
    });

    vi.mocked(playlistManagerMap.get).mockReturnValue(playlistManager as never);

    await engine.handleMessage(message('单曲播放'));

    expect(playlistManager.setPlayMode).toHaveBeenCalledWith('once');
  });

  it('downloads a searched song before adding it to a custom playlist when the library misses', async () => {
    const songloft = testSongloft();
    const resolvedSong = createSearchResultSong();
    const bridgeService = {
      resolveSearchSong: vi.fn(async () => resolvedSong),
    };
    const downloadService = {
      downloadSong: vi.fn(async () => ({ song_id: 902, status: 'ok', path: 'downloads/xs/sudi.flac' })),
    };
    songloft.songs.list = vi.fn(async () => []);
    const { engine, customPlaylistService, indexingManager, minaService } = createEngine({
      bridgeService,
      downloadService,
    });

    await engine.handleMessage(message('加入歌单 宿敌 加到歌单 收藏'));

    expect(bridgeService.resolveSearchSong).toHaveBeenCalledWith('宿敌', '');
    expect(downloadService.downloadSong).toHaveBeenCalledWith(expect.objectContaining({
      source_data: expect.objectContaining({ quality: 'flac' }),
    }));
    expect(customPlaylistService.addSong).toHaveBeenCalledWith('收藏', resolvedSong);
    expect(indexingManager.refresh).toHaveBeenCalled();
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'speaker-1', '已加入歌单：收藏');
  });
});
