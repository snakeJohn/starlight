import { describe, expect, test, vi } from 'vitest';
import { LX_SHIM } from '../../src/music/lx_shim';
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

interface ShimLx {
  request(
    url: string,
    options: Record<string, unknown>,
    callback: (error: unknown, response: unknown, text: unknown) => void,
  ): Promise<unknown>;
  on(name: string, handler: (payload: unknown) => unknown): void;
  _dispatch(id: string, event: string, payload: unknown): void;
}

interface ShimGlobal {
  lx?: ShimLx;
  __songloftEmitEvent?: (name: string, data: string) => void;
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
  const create = vi.fn(async (_name: string, _initCode?: string) => '');
  const executeWait = vi.fn(handler);
  const destroy = vi.fn(async (_name: string) => undefined);
  const jsenv = songloft.jsenv as unknown as TestJsenv;
  jsenv.create = create;
  jsenv.executeWait = executeWait;
  jsenv.destroy = destroy;

  return { create, executeWait, destroy };
}

function expectEnvName(value: string, readablePrefix: string): void {
  expect(value).toMatch(new RegExp(`^starlight_lx_${readablePrefix}(?:_[a-z0-9]+)?$`));
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

function rawEvent(name: string, data: unknown): JsenvEvent {
  return {
    name,
    data: JSON.stringify(data),
  };
}

function dispatchResultEvent(code: string, dispatchResult: unknown): JsenvEvent {
  return {
    name: 'dispatchResult',
    data: JSON.stringify({ id: dispatchCallFrom(code).id, result: dispatchResult }),
  };
}

function dispatchErrorEvent(code: string, error: string): JsenvEvent {
  return {
    name: 'dispatchError',
    data: JSON.stringify({ id: dispatchCallFrom(code).id, error }),
  };
}

function dispatchCallFrom(code: string): { id: string; event: string; payload: unknown } {
  const match = code.match(/^globalThis\.lx\._dispatch\((".*?"), "([^"]+)", (.*)\);$/);
  if (!match) {
    throw new Error(`Dispatch call not found in code: ${code}`);
  }

  return {
    id: JSON.parse(match[1]) as string,
    event: match[2],
    payload: JSON.parse(match[3]) as unknown,
  };
}

function installShim(): { shimGlobal: ShimGlobal; restore: () => void } {
  const shimGlobal = globalThis as typeof globalThis & ShimGlobal;
  const previousLx = shimGlobal.lx;
  const previousEmitEvent = shimGlobal.__songloftEmitEvent;

  delete shimGlobal.lx;
  shimGlobal.__songloftEmitEvent = vi.fn();
  Function(LX_SHIM)();

  return {
    shimGlobal,
    restore: () => {
      if (previousLx === undefined) {
        delete shimGlobal.lx;
      } else {
        shimGlobal.lx = previousLx;
      }

      if (previousEmitEvent === undefined) {
        delete shimGlobal.__songloftEmitEvent;
      } else {
        shimGlobal.__songloftEmitEvent = previousEmitEvent;
      }
    },
  };
}

function parseEmittedData(event: { data: string }): unknown {
  return JSON.parse(event.data) as unknown;
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

async function createRuntimeWithDispatch(
  dispatchResult: unknown,
): Promise<{ runtime: SourceRuntime; dispatches: Array<{ id: string; event: string; payload: unknown }> }> {
  const dispatches: Array<{ id: string; event: string; payload: unknown }> = [];
  installJsenvMock((name, code, timeoutMs, waitEvents) => {
    expect(timeoutMs).toBe(30000);

    if (waitEvents.includes('inited')) {
      return result([initedEvent({ kw: {} })]);
    }

    expectEnvName(name, 'synthetic_source');
    expect(waitEvents).toEqual(['dispatchResult', 'dispatchError']);
    const dispatch = dispatchCallFrom(code);
    dispatches.push(dispatch);
    return result([dispatchResultEvent(code, dispatchResult)]);
  });

  const runtime = await SourceRuntime.create('synthetic/source', syntheticScript);
  expect(runtime).not.toBeNull();
  return { runtime: runtime as SourceRuntime, dispatches };
}

describe('SourceRuntime', () => {
  test('loads a source and reads supported platforms from inited event', async () => {
    const { create, executeWait } = installJsenvMock((name, code, timeoutMs, waitEvents) => {
      expectEnvName(name, 'source_1');
      expect(code).toBe(syntheticScript);
      expect(timeoutMs).toBe(30000);
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent({ kw: {}, kg: {} })]);
    });

    const runtime = await SourceRuntime.create('source.1', syntheticScript);

    expect(runtime).not.toBeNull();
    expect(create).toHaveBeenCalledWith(
      expect.stringMatching(/^starlight_lx_source_1(?:_[a-z0-9]+)?$/),
      expect.stringContaining("globalThis.lx.env = 'desktop'"),
    );
    expect(executeWait).toHaveBeenCalledTimes(1);
    expect(runtime?.supportsPlatform('kw')).toBe(true);
    expect(runtime?.supportsPlatform('kg')).toBe(true);
    expect(runtime?.supportsPlatform('wy')).toBe(false);
  });

  test('create appends stable hash to readable env name for sanitized collisions', async () => {
    const { create } = installJsenvMock((_name, _code, _timeoutMs, waitEvents) => {
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent({ kw: {} })]);
    });

    const first = await SourceRuntime.create('source!id', syntheticScript);
    const second = await SourceRuntime.create('source?id', syntheticScript);

    const [firstEnvName, secondEnvName] = create.mock.calls.map((call) => call[0]);
    expect(firstEnvName).toMatch(/^starlight_lx_source_id_[a-z0-9]+$/);
    expect(secondEnvName).toMatch(/^starlight_lx_source_id_[a-z0-9]+$/);
    expect(firstEnvName).not.toBe(secondEnvName);

    await first.destroy();
    await second.destroy();
  });

  test('getMusicUrl returns a dispatch result string URL', async () => {
    const { runtime, dispatches } = await createRuntimeWithDispatch('https://cdn.invalid/song.mp3');

    await expect(runtime.getMusicUrl('kw', '320k', songInfo)).resolves.toBe('https://cdn.invalid/song.mp3');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].id).toMatch(/^musicUrl_\d+$/);
    expect(dispatches[0].event).toBe('request');
    expect(dispatches[0].payload).toEqual({
      source: 'kw',
      action: 'musicUrl',
      info: {
        musicInfo: songInfo,
        type: '320k',
      },
    });
  });

  test('getMusicUrl supports object dispatch result with url', async () => {
    const { runtime } = await createRuntimeWithDispatch({ url: 'https://cdn.invalid/object.flac' });

    await expect(runtime.getMusicUrl('kw', 'flac', songInfo)).resolves.toBe('https://cdn.invalid/object.flac');
  });

  test('getMusicUrl returns null on dispatch error', async () => {
    installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      expectEnvName(name, 'error_source');
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

  test('serializes concurrent getMusicUrl dispatches on one runtime', async () => {
    const dispatches: Array<{ id: string; event: string; payload: unknown }> = [];
    const releases: Array<(url: string) => void> = [];
    const released = new Set<number>();
    installJsenvMock((_name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      const dispatch = dispatchCallFrom(code);
      dispatches.push(dispatch);
      return new Promise<JsenvResult>((resolve) => {
        releases.push((url) => resolve(result([dispatchResultEvent(code, url)])));
      });
    });
    const runtime = await SourceRuntime.create('serialized/source', syntheticScript);

    const first = runtime.getMusicUrl('kw', '320k', songInfo);
    const second = runtime.getMusicUrl('kw', 'flac', { ...songInfo, musicId: 'second-id' });

    const release = (index: number, url: string) => {
      if (!released.has(index) && releases[index]) {
        released.add(index);
        releases[index](url);
      }
    };

    try {
      await Promise.resolve();
      expect(dispatches).toHaveLength(1);

      release(0, 'https://cdn.invalid/first.mp3');
      await expect(first).resolves.toBe('https://cdn.invalid/first.mp3');
      await Promise.resolve();

      expect(dispatches).toHaveLength(2);
      expect(dispatches[0].id).not.toBe(dispatches[1].id);

      release(1, 'https://cdn.invalid/second.flac');
      await expect(second).resolves.toBe('https://cdn.invalid/second.flac');
    } finally {
      release(0, 'https://cdn.invalid/cleanup-first.mp3');
      await Promise.resolve();
      release(1, 'https://cdn.invalid/cleanup-second.mp3');
      await Promise.allSettled([first, second]);
    }
  });

  test('create destroys env and throws structured error on script eval failure', async () => {
    const { destroy } = installJsenvMock(() => result([], 'SyntaxError: synthetic failure'));

    await expect(SourceRuntime.create('broken/source', 'throw new Error("synthetic")')).rejects.toMatchObject({
      code: 'SOURCE_RUNTIME_FAILED',
      message: 'SyntaxError: synthetic failure',
      retryable: false,
    });
    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_broken_source(?:_[a-z0-9]+)?$/));
  });

  test('missing inited event destroys env and throws SOURCE_IMPORT_INVALID', async () => {
    const { destroy } = installJsenvMock(() => result([]));
    const createPromise = SourceRuntime.create('missing/inited', syntheticScript);

    await expect(createPromise).rejects.toMatchObject({
      code: 'SOURCE_IMPORT_INVALID',
      message: '音源未调用 lx.send("inited")',
      retryable: false,
    });
    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_missing_inited(?:_[a-z0-9]+)?$/));
  });

  test('malformed inited payload destroys env and throws SOURCE_IMPORT_INVALID', async () => {
    const { destroy } = installJsenvMock(() => result([rawEvent('inited', { sources: [] })]));

    await expect(SourceRuntime.create('malformed/inited', syntheticScript)).rejects.toMatchObject({
      code: 'SOURCE_IMPORT_INVALID',
      retryable: false,
    });
    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_malformed_inited(?:_[a-z0-9]+)?$/));
  });
});

describe('LX_SHIM', () => {
  test('lx.request calls back with error, response, and text on success', async () => {
    const { shimGlobal, restore } = installShim();
    const previousFetch = globalThis.fetch;
    const callback = vi.fn();
    const response = {
      status: 201,
      headers: {
        forEach(handler: (value: string, key: string) => void) {
          handler('text/plain', 'content-type');
        },
      },
      text: async () => 'body text',
    } as Response;
    globalThis.fetch = vi.fn(async () => response);

    try {
      const promiseResult = await shimGlobal.lx?.request('https://example.invalid/api', { method: 'POST' }, callback);

      expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ status: 201 }), 'body text');
      expect(promiseResult).toEqual(expect.objectContaining({ status: 201, body: 'body text', data: 'body text' }));
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test('lx.request calls back with error, null, and null on failure', async () => {
    const { shimGlobal, restore } = installShim();
    const previousFetch = globalThis.fetch;
    const callback = vi.fn();
    const error = new Error('network failed');
    globalThis.fetch = vi.fn(async () => {
      throw error;
    });

    try {
      await expect(shimGlobal.lx?.request('https://example.invalid/api', {}, callback)).resolves.toBeNull();
      expect(callback).toHaveBeenCalledWith(error, null, null);
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test('_dispatch emits dispatchError from error message instead of stack', async () => {
    const { shimGlobal, restore } = installShim();
    const emittedEvents: Array<{ name: string; data: string }> = [];
    shimGlobal.__songloftEmitEvent = (name, data) => emittedEvents.push({ name, data });
    shimGlobal.lx?.on('request', () => {
      const error = new Error('resolver failed');
      error.stack = 'stack details';
      throw error;
    });

    try {
      shimGlobal.lx?._dispatch('dispatch-1', 'request', {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe('dispatchError');
      expect(parseEmittedData(emittedEvents[0])).toStrictEqual({
        id: 'dispatch-1',
        error: 'resolver failed',
      });
    } finally {
      restore();
    }
  });

  test('_dispatch emits dispatchResult with only id and result', async () => {
    const { shimGlobal, restore } = installShim();
    const emittedEvents: Array<{ name: string; data: string }> = [];
    shimGlobal.__songloftEmitEvent = (name, data) => emittedEvents.push({ name, data });
    shimGlobal.lx?.on('request', (payload) => ({ url: `https://cdn.invalid/${String(payload)}.mp3` }));

    try {
      shimGlobal.lx?._dispatch('dispatch-2', 'request', 'song');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe('dispatchResult');
      expect(parseEmittedData(emittedEvents[0])).toStrictEqual({
        id: 'dispatch-2',
        result: { url: 'https://cdn.invalid/song.mp3' },
      });
    } finally {
      restore();
    }
  });

  test('_dispatch missing handler emits dispatchError with only id and error', () => {
    const { shimGlobal, restore } = installShim();
    const emittedEvents: Array<{ name: string; data: string }> = [];
    shimGlobal.__songloftEmitEvent = (name, data) => emittedEvents.push({ name, data });

    try {
      shimGlobal.lx?._dispatch('dispatch-3', 'missing', {});

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe('dispatchError');
      expect(parseEmittedData(emittedEvents[0])).toStrictEqual({
        id: 'dispatch-3',
        error: 'No listener registered for event: missing',
      });
    } finally {
      restore();
    }
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
    expect(create).toHaveBeenCalledWith(
      expect.stringMatching(/^starlight_lx_enabled-a(?:_[a-z0-9]+)?$/),
      expect.any(String),
    );

    sources = [sourceMeta('enabled-c', true)];
    await manager.loadEnabledSources();

    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_enabled-a(?:_[a-z0-9]+)?$/));
    expect(manager.count()).toBe(1);
    expect(managerSource.getScript).toHaveBeenLastCalledWith('enabled-c');
    expect(create).toHaveBeenCalledWith(
      expect.stringMatching(/^starlight_lx_enabled-c(?:_[a-z0-9]+)?$/),
      expect.any(String),
    );
  });

  test('loadEnabledSources continues when one enabled source script fails to load', async () => {
    const getScript = vi.fn(async (id: string) => {
      if (id === 'broken') {
        throw new Error('script read failed');
      }

      return id === 'later' ? 'later-script' : null;
    });
    const managerSource = {
      listSources: () => [sourceMeta('broken', true), sourceMeta('later', true)],
      getScript,
    } as unknown as SourceManager;
    const { create } = installJsenvMock((_name, code, _timeoutMs, waitEvents) => {
      expect(code).toBe('later-script');
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent({ kg: {} })]);
    });
    const manager = new RuntimeManager(managerSource);

    await expect(manager.loadEnabledSources()).resolves.toBeUndefined();

    expect(getScript).toHaveBeenNthCalledWith(1, 'broken');
    expect(getScript).toHaveBeenNthCalledWith(2, 'later');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.stringMatching(/^starlight_lx_later(?:_[a-z0-9]+)?$/),
      expect.any(String),
    );
    expect(manager.count()).toBe(1);
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

    await expect(manager.getMusicUrl('kg', '320k', songInfo)).resolves.toMatch(
      /^https:\/\/cdn\.invalid\/starlight_lx_kg-only(?:_[a-z0-9]+)?\.mp3$/,
    );

    const dispatchCalls = executeWait.mock.calls.filter((call) => call[3].includes('dispatchResult'));
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0][0]).toMatch(/^starlight_lx_kg-only(?:_[a-z0-9]+)?$/);
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

    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_enabled-a(?:_[a-z0-9]+)?$/));
    expect(manager.count()).toBe(0);
  });
});
