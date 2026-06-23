import { afterEach, describe, expect, it, vi } from 'vitest';

interface PluginPlayerModule {
  playPluginQueue(songs: Array<Record<string, unknown>>, startIndex?: number): void;
  runPluginPlayerAction(action: string): void;
  renderPluginPlayer(): string;
}

interface MusicModule {
  previewSong(song: Record<string, unknown>): Promise<unknown>;
}

interface StateModule {
  state: {
    pluginPlayerQueue: Array<Record<string, unknown>>;
    pluginPlayerIndex: number;
    pluginPlayerState: string;
    pluginPlayerMode: string;
  };
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

function installDom(postMessage = vi.fn()) {
  const node = { className: '', textContent: '', remove: vi.fn() };
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => node),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    parent: { postMessage },
  });
  vi.stubGlobal('CustomEvent', class {
    type: string;
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });
  return { postMessage };
}

async function loadPluginPlayer() {
  const player = await import('../../static/js/plugin_player.js') as PluginPlayerModule;
  const stateModule = await import('../../static/js/state.js') as StateModule;
  return { player, state: stateModule.state };
}

async function loadMusic() {
  return await import('../../static/js/music.js') as MusicModule;
}

describe('plugin local player controls', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an independent plugin player control with queue list', async () => {
    installDom();
    const { player } = await loadPluginPlayer();

    const html = player.renderPluginPlayer();

    expect(html).toContain('data-role="plugin-player"');
    expect(html).toContain('data-action="plugin-player-previous"');
    expect(html).toContain('data-action="plugin-player-toggle"');
    expect(html).toContain('data-action="plugin-player-next"');
    expect(html).toContain('data-action="plugin-player-stop"');
    expect(html).toContain('data-action="plugin-player-mode"');
    expect(html).toContain('data-role="plugin-player-queue"');
    expect(html).not.toContain('global-player-');
  });

  it('routes single song playback to the plugin queue and native player request', async () => {
    const { postMessage } = installDom();
    const importedSong = { id: 99, type: 'remote', title: '晴天', artist: '周杰伦' };
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ total: 1, songs: [importedSong] }) as Response));
    const music = await loadMusic();
    const { state } = await loadPluginPlayer();

    await music.previewSong({
      title: '晴天',
      artist: '周杰伦',
      source_data: { platform: 'kw', quality: '320k', songInfo: {} },
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'songloft:native-player:play',
      songs: [importedSong],
      startIndex: 0,
    }, '*');
    expect(state.pluginPlayerQueue).toEqual([importedSong]);
    expect(state.pluginPlayerIndex).toBe(0);
    expect(state.pluginPlayerState).toBe('playing');
  });

  it('updates local state for previous, toggle, next, stop, and mode actions', async () => {
    installDom();
    const { player, state } = await loadPluginPlayer();
    player.playPluginQueue([
      { title: '第一首', artist: '歌手 A' },
      { title: '第二首', artist: '歌手 B' },
      { title: '第三首', artist: '歌手 C' },
    ], 1);

    player.runPluginPlayerAction('plugin-player-next');
    expect(state.pluginPlayerIndex).toBe(2);
    expect(state.pluginPlayerState).toBe('playing');

    player.runPluginPlayerAction('plugin-player-toggle');
    expect(state.pluginPlayerState).toBe('paused');

    player.runPluginPlayerAction('plugin-player-toggle');
    expect(state.pluginPlayerState).toBe('playing');

    player.runPluginPlayerAction('plugin-player-previous');
    expect(state.pluginPlayerIndex).toBe(1);

    player.runPluginPlayerAction('plugin-player-mode');
    expect(state.pluginPlayerMode).toBe('loop');

    player.runPluginPlayerAction('plugin-player-stop');
    expect(state.pluginPlayerState).toBe('stopped');
  });

  it('sends plugin player controls to the native bottom player', async () => {
    const { postMessage } = installDom();
    const { player } = await loadPluginPlayer();
    player.playPluginQueue([
      { title: '第一首', artist: '歌手 A' },
      { title: '第二首', artist: '歌手 B' },
    ], 0);

    player.runPluginPlayerAction('plugin-player-next');
    player.runPluginPlayerAction('plugin-player-toggle');
    player.runPluginPlayerAction('plugin-player-toggle');
    player.runPluginPlayerAction('plugin-player-previous');
    player.runPluginPlayerAction('plugin-player-stop');

    expect(postMessage).toHaveBeenCalledWith({ type: 'songloft:native-player:control', action: 'next' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'songloft:native-player:control', action: 'pause' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'songloft:native-player:control', action: 'resume' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'songloft:native-player:control', action: 'previous' }, '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'songloft:native-player:control', action: 'stop' }, '*');
  });

  it('renders the current queue with the active song highlighted', async () => {
    installDom();
    const { player } = await loadPluginPlayer();
    player.playPluginQueue([
      { title: '第一首', artist: '歌手 A', cover_url: 'https://img.test/a.jpg' },
      { title: '第二首', artist: '歌手 B' },
    ], 1);

    const html = player.renderPluginPlayer();

    expect(html).toContain('https://img.test/a.jpg');
    expect(html).toContain('第一首');
    expect(html).toContain('第二首');
    expect(html).toContain('plugin-player-queue-item active');
  });
});
