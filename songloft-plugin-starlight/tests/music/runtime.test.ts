import { describe, expect, test, vi } from 'vitest';
import { RuntimeManager } from '../../src/music/runtime_manager';
import { SourceRuntime } from '../../src/music/runtime';
import type { SourceManager } from '../../src/music/source_manager';
import type { LxSongInfo, MusicPlatform, MusicQuality, MusicSourceMeta } from '../../src/music/types';
import { StarlightError } from '../../src/system/errors';

interface JsenvEvent {
  name: string;
  data: string;
}

interface JsenvResult {
  result: string;
  error?: string;
  events: JsenvEvent[];
}

type ExecuteWaitHandler = (
  name: string,
  code: string,
  timeoutMs: number,
  waitEvents: string[],
) => Promise<JsenvResult> | JsenvResult;

interface TestJsenv {
  create: (name: string, initCode?: string) => Promise<string>;
  executeWait: ExecuteWaitHandler;
  destroy: (name: string) => Promise<void>;
}

const syntheticScript = String.raw`lx.send('inited', { sources: { kw: {}, kg: {} } });`;

const songInfo: LxSongInfo = {
  source: 'kw',
  name: 'Synthetic Song',
  singer: 'Synthetic Artist',
  album: 'Synthetic Album',
  duration: 180,
  musicId: 'synthetic-id',
};

function installJsenvMock(handler: ExecuteWaitHandler) {
  const create = vi.fn(async () => '');
  const executeWait = vi.fn(handler);
  const destroy = vi.fn(async () => undefined);
  const jsenv = songloft.jsenv as unknown as TestJsenv;
  jsenv.create = create;
  jsenv.executeWait = executeWait;
  jsenv.destroy = destroy;

  return { create, executeWait, destroy };
}

function result(events: JsenvEvent[], error = ''): JsenvResult {
  return { result: '', error, events };
}

function initedEvent(sources: Record<string, unknown>): JsenvEvent {
  return {
    name: 'inited',
    data: JSON.stringify({ sources }),
  };
}

function dispatchResultEvent(code: string, dispatchResult: unknown): JsenvEvent {
  return {
    name: 'dispatchResult',
    data: JSON.stringify({ id: dispatchIdFrom(code), result: dispatchResult }),
  };
}

function dispatchErrorEvent(code: string, error: string): JsenvEvent {
  return {
    name: 'dispatchError',
    data: JSON.stringify({ id: dispatchIdFrom(code), error }),
  };
}

function dispatchIdFrom(code: string): string {
  const match = code.match(/_dispatch\("([^"]+)"/);
  if (!match) {
    throw new Error(`Dispatch id not found in code: ${code}`);
  }

  return match[1];
}

function sourceMeta(id: string, enabled: boolean): MusicSourceMeta {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: '',
    author: '',
    homepage: '',
    filename: `${id}.js`,
    importedAt: '2026-06-21T00:00:00.000Z',
    enabled,
    supportedPlatforms: [],
  };
}

function fakeSourceManager(
  listSources: () => MusicSourceMeta[],
  scripts: Record<string, string>,
): SourceManager {
  return {
    listSources,
    getScript: vi.fn(async (id: string) => scripts[id] ?? null),
  } as unknown as SourceManager;
}

async function createRuntimeWithDispatch(dispatchResult: unknown): Promise<SourceRuntime> {
  installJsenvMock((name, code, timeoutMs, waitEvents) => {
    expect(timeoutMs).toBe(30000);

    if (waitEvents.includes('inited')) {
      return result([initedEvent({ kw: {} })]);
    }

    expect(name).toBe('starlight_lx_synthetic_source');
    expect(waitEvents).toEqual(['dispatchResult', 'dispatchError']);
    expect(code).toContain('"musicUrl"');
    expect(code).toContain('"platform":"kw"');
    return result([dispatchResultEvent(code, dispatchResult)]);
  });

  const runtime = await SourceRuntime.create('synthetic/source', syntheticScript);
  expect(runtime).not.toBeNull();
  return runtime as SourceRuntime;
}

describe('SourceRuntime', () => {
  test('loads a source and reads supported platforms from inited event', async () => {
    const { create, executeWait } = installJsenvMock((name, code, timeoutMs, waitEvents) => {
      expect(name).toBe('starlight_lx_source_1');
      expect(code).toBe(syntheticScript);
      expect(timeoutMs).toBe(30000);
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent({ kw: {}, kg: {} })]);
    });

    const runtime = await SourceRuntime.create('source.1', syntheticScript);

    expect(runtime).not.toBeNull();
    expect(create).toHaveBeenCalledWith(
      'starlight_lx_source_1',
      expect.stringContaining("globalThis.lx.env = 'desktop'"),
    );
    expect(executeWait).toHaveBeenCalledTimes(1);
    expect(runtime?.supportsPlatform('kw')).toBe(true);
    expect(runtime?.supportsPlatform('kg')).toBe(true);
    expect(runtime?.supportsPlatform('wy')).toBe(false);
  });

  test('getMusicUrl returns a dispatch result string URL', async () => {
    const runtime = await createRuntimeWithDispatch('https://cdn.invalid/song.mp3');

    await expect(runtime.getMusicUrl('kw', '320k', songInfo)).resolves.toBe('https://cdn.invalid/song.mp3');
  });

  test('getMusicUrl supports object dispatch result with url', async () => {
    const runtime = await createRuntimeWithDispatch({ url: 'https://cdn.invalid/object.flac' });

    await expect(runtime.getMusicUrl('kw', 'flac', songInfo)).resolves.toBe('https://cdn.invalid/object.flac');
  });

  test('getMusicUrl returns null on dispatch error', async () => {
    installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      expect(name).toBe('starlight_lx_error_source');
      return result([dispatchErrorEvent(code, 'resolver failed')]);
    });
    const runtime = await SourceRuntime.create('error/source', syntheticScript);

    await expect(runtime?.getMusicUrl('kw', '320k', songInfo)).resolves.toBeNull();
  });

  test('getMusicUrl returns null when dispatch result is missing', async () => {
    installJsenvMock((_name, _code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      return result([]);
    });
    const runtime = await SourceRuntime.create('missing/result', syntheticScript);

    await expect(runtime?.getMusicUrl('kw', '320k', songInfo)).resolves.toBeNull();
  });

  test('create destroys env and throws structured error on script eval failure', async () => {
    const { destroy } = installJsenvMock(() => result([], 'SyntaxError: synthetic failure'));

    await expect(SourceRuntime.create('broken/source', 'throw new Error("synthetic")')).rejects.toMatchObject({
      code: 'SOURCE_RUNTIME_FAILED',
      message: 'SyntaxError: synthetic failure',
      retryable: false,
    });
    expect(destroy).toHaveBeenCalledWith('starlight_lx_broken_source');
  });

  test('missing inited event destroys env and throws SOURCE_IMPORT_INVALID', async () => {
    const { destroy } = installJsenvMock(() => result([]));

    await expect(SourceRuntime.create('missing/inited', syntheticScript)).rejects.toThrow(StarlightError);
    await expect(SourceRuntime.create('missing/inited', syntheticScript)).rejects.toMatchObject({
      code: 'SOURCE_IMPORT_INVALID',
      message: '音源未调用 lx.send("inited")',
      retryable: false,
    });
    expect(destroy).toHaveBeenCalledWith('starlight_lx_missing_inited');
  });
});

describe('RuntimeManager', () => {
  test('loads only enabled sources from SourceManager and closes old runtimes on reload', async () => {
    let sources = [sourceMeta('enabled-a', true), sourceMeta('disabled-b', false)];
    const managerSource = fakeSourceManager(() => sources, {
      'enabled-a': 'script-a',
      'disabled-b': 'script-b',
      'enabled-c': 'script-c',
    });
    const { create, destroy } = installJsenvMock((_name, code, _timeoutMs, waitEvents) => {
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent(code === 'script-c' ? { kg: {} } : { kw: {} })]);
    });
    const manager = new RuntimeManager(managerSource);

    await manager.loadEnabledSources();

    expect(manager.count()).toBe(1);
    expect(managerSource.getScript).toHaveBeenCalledTimes(1);
    expect(managerSource.getScript).toHaveBeenCalledWith('enabled-a');
    expect(create).toHaveBeenCalledWith('starlight_lx_enabled-a', expect.any(String));

    sources = [sourceMeta('enabled-c', true)];
    await manager.loadEnabledSources();

    expect(destroy).toHaveBeenCalledWith('starlight_lx_enabled-a');
    expect(manager.count()).toBe(1);
    expect(managerSource.getScript).toHaveBeenLastCalledWith('enabled-c');
    expect(create).toHaveBeenCalledWith('starlight_lx_enabled-c', expect.any(String));
  });

  test('getMusicUrl skips unsupported platforms and returns first matching URL', async () => {
    const managerSource = fakeSourceManager(
      () => [sourceMeta('kw-only', true), sourceMeta('kg-only', true)],
      {
        'kw-only': 'kw-script',
        'kg-only': 'kg-script',
      },
    );
    const { executeWait } = installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent(code === 'kw-script' ? { kw: {} } : { kg: {} })]);
      }

      return result([dispatchResultEvent(code, `https://cdn.invalid/${name}.mp3`)]);
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    await expect(manager.getMusicUrl('kg', '320k', songInfo)).resolves.toBe(
      'https://cdn.invalid/starlight_lx_kg-only.mp3',
    );

    const dispatchCalls = executeWait.mock.calls.filter((call) => call[3].includes('dispatchResult'));
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0][0]).toBe('starlight_lx_kg-only');
  });

  test('getMusicUrl returns null when no runtime matches the platform', async () => {
    const managerSource = fakeSourceManager(
      () => [sourceMeta('kw-only', true), sourceMeta('tx-only', true)],
      {
        'kw-only': 'kw-script',
        'tx-only': 'tx-script',
      },
    );
    const { executeWait } = installJsenvMock((_name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent(code === 'kw-script' ? { kw: {} } : { tx: {} })]);
      }

      return result([dispatchResultEvent(code, 'https://cdn.invalid/unexpected.mp3')]);
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    await expect(manager.getMusicUrl('kg', '320k', songInfo)).resolves.toBeNull();

    const dispatchCalls = executeWait.mock.calls.filter((call) => call[3].includes('dispatchResult'));
    expect(dispatchCalls).toHaveLength(0);
  });

  test('close destroys loaded runtimes and clears count', async () => {
    const managerSource = fakeSourceManager(() => [sourceMeta('enabled-a', true)], {
      'enabled-a': 'script-a',
    });
    const { destroy } = installJsenvMock(() => result([initedEvent({ kw: {} })]));
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    await manager.close();

    expect(destroy).toHaveBeenCalledWith('starlight_lx_enabled-a');
    expect(manager.count()).toBe(0);
  });
});
