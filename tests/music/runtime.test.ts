import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LX_SHIM } from '../../src/music/lx_shim';
import { RuntimeManager } from '../../src/music/runtime_manager';
import { SourceRuntime } from '../../src/music/runtime';
import type { SourceManager } from '../../src/music/source_manager';
import type { LxSongInfo, MusicSourceMeta } from '../../src/music/types';
import { sourceDiagnostics } from '../../src/diagnostics/source_logs';

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
  EVENT_NAMES: {
    request: string;
    inited: string;
    updateAlert: string;
  };
  utils: {
    buffer: {
      bufToString(value: unknown, encoding?: string): string;
    };
  };
  request(
    url: string,
    options: Record<string, unknown>,
    callback: (error: unknown, response: unknown, text: unknown) => void,
  ): Promise<unknown>;
  on(name: string, handler: (payload: unknown) => unknown): void;
  send(name: string, data: unknown): void;
  _dispatch(id: string, event: string, payload: unknown): void;
}

interface ShimGlobal {
  lx?: ShimLx;
  __songloftEmitEvent?: (name: string, data: string) => void;
  __go_send?: (name: string, data: string) => void;
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

beforeEach(() => {
  sourceDiagnostics.clear();
});

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
  const previousGoSend = shimGlobal.__go_send;

  delete shimGlobal.lx;
  shimGlobal.__songloftEmitEvent = vi.fn();
  delete shimGlobal.__go_send;
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

      if (previousGoSend === undefined) {
        delete shimGlobal.__go_send;
      } else {
        shimGlobal.__go_send = previousGoSend;
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

async function flushMicrotasks(turns = 5): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

async function waitForMicrotaskCondition(condition: () => boolean, turns = 50): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
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

  test('queued getMusicUrl returns null without dispatching after destroy starts', async () => {
    const dispatches: Array<{ id: string; event: string; payload: unknown }> = [];
    const releases: Array<(url: string) => void> = [];
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
    const runtime = await SourceRuntime.create('destroy/queued', syntheticScript);

    const first = runtime.getMusicUrl('kw', '320k', songInfo);
    await Promise.resolve();
    expect(dispatches).toHaveLength(1);

    const queued = runtime.getMusicUrl('kw', 'flac', { ...songInfo, musicId: 'queued-id' });
    await Promise.resolve();
    expect(dispatches).toHaveLength(1);

    const destroyPromise = runtime.destroy();
    releases[0]('https://cdn.invalid/first.mp3');
    await expect(first).resolves.toBe('https://cdn.invalid/first.mp3');
    await Promise.resolve();
    releases[1]?.('https://cdn.invalid/queued.flac');

    await expect(queued).resolves.toBeNull();
    await expect(destroyPromise).resolves.toBeUndefined();
    expect(dispatches).toHaveLength(1);
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

  test('accepts a valid inited event even when later optional source code reports an error', async () => {
    const { destroy } = installJsenvMock(() =>
      result([initedEvent({ kw: {} })], 'ReferenceError: setTimeout is not defined'),
    );

    const runtime = await SourceRuntime.create('late/error', syntheticScript);

    expect(runtime.supportsPlatform('kw')).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
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
  test('exposes common LX event constants and buffer helpers', () => {
    const { shimGlobal, restore } = installShim();

    try {
      expect(shimGlobal.lx?.EVENT_NAMES).toEqual({
        request: 'request',
        inited: 'inited',
        updateAlert: 'updateAlert',
      });
      expect(shimGlobal.lx?.utils.buffer.bufToString('body text', 'utf-8')).toBe('body text');
    } finally {
      restore();
    }
  });

  test('lx.send uses the Songloft jsenv __go_send bridge when present', () => {
    const { shimGlobal, restore } = installShim();
    const emittedEvents: Array<{ name: string; data: string }> = [];
    delete shimGlobal.__songloftEmitEvent;
    shimGlobal.__go_send = (name, data) => emittedEvents.push({ name, data });

    try {
      shimGlobal.lx?.send('inited', { sources: { kw: {} } });

      expect(emittedEvents).toEqual([
        { name: 'inited', data: JSON.stringify({ sources: { kw: {} } }) },
      ]);
    } finally {
      restore();
    }
  });

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

      expect(callback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ statusCode: 201, body: 'body text' }),
        'body text',
      );
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

  test('lx.request resolves through callback error when the timeout elapses', async () => {
    vi.useFakeTimers();
    const { shimGlobal, restore } = installShim();
    const previousFetch = globalThis.fetch;
    const callback = vi.fn();
    globalThis.fetch = vi.fn(async () => new Promise<Response>(() => {}));

    try {
      const requestPromise = shimGlobal.lx?.request('https://example.invalid/api', { timeout: 500 }, callback);
      await vi.advanceTimersByTimeAsync(500);

      await expect(Promise.race([requestPromise, Promise.resolve('pending')])).resolves.toBeNull();
      expect(callback).toHaveBeenCalledWith(expect.any(Error), null, null);
      expect(callback.mock.calls[0][0].message).toContain('timeout');
      expect(globalThis.fetch).toHaveBeenCalledWith('https://example.invalid/api', {
        method: 'GET',
        headers: {},
      });
    } finally {
      vi.useRealTimers();
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test('lx.request fails timeout-guarded requests without fetch when timers are unavailable', async () => {
    const { shimGlobal, restore } = installShim();
    const previousFetch = globalThis.fetch;
    const previousSetTimeout = globalThis.setTimeout;
    const callback = vi.fn();
    globalThis.fetch = vi.fn(async () => new Promise<Response>(() => {}));
    vi.stubGlobal('setTimeout', undefined);

    try {
      const requestPromise = shimGlobal.lx?.request('https://example.invalid/api', { timeout: 500 }, callback);

      await expect(Promise.race([requestPromise, Promise.resolve('pending')])).resolves.toBeNull();
      expect(callback).toHaveBeenCalledWith(expect.any(Error), null, null);
      expect(callback.mock.calls[0][0].message).toContain('timeout');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('setTimeout', previousSetTimeout);
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

  test('reload waits for in-flight dispatch before recreating the same env', async () => {
    const managerSource = fakeSourceManager(() => [sourceMeta('same-source', true)], {
      'same-source': 'script',
    });
    const dispatches: Array<{ envName: string; code: string }> = [];
    const dispatchControl: { release?: (url: string) => void } = {};
    const { create, destroy } = installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      dispatches.push({ envName: name, code });
      return new Promise<JsenvResult>((resolve) => {
        dispatchControl.release = (url) => resolve(result([dispatchResultEvent(code, url)]));
      });
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    const oldLookup = manager.getMusicUrl('kw', '320k', songInfo);
    await Promise.resolve();
    expect(dispatches).toHaveLength(1);

    const reload = manager.loadEnabledSources();
    await Promise.resolve();
    expect(destroy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    dispatchControl.release?.('https://cdn.invalid/old.mp3');
    await expect(oldLookup).resolves.toBe('https://cdn.invalid/old.mp3');
    await reload;

    expect(destroy).toHaveBeenCalledWith(dispatches[0].envName);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toBe(dispatches[0].envName);
  });

  test('concurrent reloads do not recreate the same env until old destroy settles', async () => {
    const managerSource = fakeSourceManager(() => [sourceMeta('same-source', true)], {
      'same-source': 'script',
    });
    const dispatches: Array<{ envName: string; code: string }> = [];
    const dispatchControl: { release?: (url: string) => void } = {};
    const { create, destroy } = installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }

      dispatches.push({ envName: name, code });
      return new Promise<JsenvResult>((resolve) => {
        dispatchControl.release = (url) => resolve(result([dispatchResultEvent(code, url)]));
      });
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    const oldLookup = manager.getMusicUrl('kw', '320k', songInfo);
    await flushMicrotasks();
    expect(dispatches).toHaveLength(1);

    const firstReload = manager.loadEnabledSources();
    await flushMicrotasks();
    const secondReload = manager.loadEnabledSources();
    await flushMicrotasks();

    expect(destroy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    dispatchControl.release?.('https://cdn.invalid/old.mp3');
    await expect(oldLookup).resolves.toBe('https://cdn.invalid/old.mp3');
    await Promise.all([firstReload, secondReload]);

    expect(destroy).toHaveBeenCalledWith(dispatches[0].envName);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1][0]).toBe(dispatches[0].envName);
    expect(create.mock.calls[2][0]).toBe(dispatches[0].envName);
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

  test('getMusicUrl continues to later enabled sources when one source throws', async () => {
    const manager = new RuntimeManager(fakeSourceManager(() => [], {}));
    const throwingRuntime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => {
        throw new Error('resolver exploded');
      }),
      destroy: vi.fn(),
    };
    const workingRuntime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => 'https://cdn.invalid/working.mp3'),
      destroy: vi.fn(),
    };
    (manager as unknown as { runtimes: SourceRuntime[] }).runtimes = [
      throwingRuntime as unknown as SourceRuntime,
      workingRuntime as unknown as SourceRuntime,
    ];

    await expect(manager.getMusicUrl('kw', '320k', songInfo)).resolves.toBe('https://cdn.invalid/working.mp3');

    expect(throwingRuntime.getMusicUrl).toHaveBeenCalledWith('kw', '320k', expect.objectContaining({
      musicId: 'synthetic-id',
      songmid: 'synthetic-id',
    }));
    expect(workingRuntime.getMusicUrl).toHaveBeenCalledWith('kw', '320k', expect.objectContaining({
      musicId: 'synthetic-id',
      songmid: 'synthetic-id',
    }));
  });

  test('getMusicUrl continues to later enabled sources when one source times out', async () => {
    const manager = new RuntimeManager(fakeSourceManager(() => [], {}), { musicUrlTimeoutMs: 5 });
    const slowRuntime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => new Promise<string>(() => {})),
      destroy: vi.fn(),
    };
    const workingRuntime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => 'https://cdn.invalid/working-after-timeout.mp3'),
      destroy: vi.fn(),
    };
    (manager as unknown as { runtimes: SourceRuntime[] }).runtimes = [
      slowRuntime as unknown as SourceRuntime,
      workingRuntime as unknown as SourceRuntime,
    ];

    await expect(manager.getMusicUrl('kw', '320k', songInfo)).resolves.toBe('https://cdn.invalid/working-after-timeout.mp3');

    expect(slowRuntime.getMusicUrl).toHaveBeenCalledWith('kw', '320k', expect.objectContaining({
      musicId: 'synthetic-id',
      songmid: 'synthetic-id',
    }));
    expect(workingRuntime.getMusicUrl).toHaveBeenCalledWith('kw', '320k', expect.objectContaining({
      musicId: 'synthetic-id',
      songmid: 'synthetic-id',
    }));
    expect(manager.getLastMusicUrlAttempt()).toEqual({
      attemptedSources: 2,
      lastFailure: 'music URL source timed out after 5ms',
    });
  });

  test('getMusicUrl copies musicId into songmid before invoking source runtimes', async () => {
    const manager = new RuntimeManager(fakeSourceManager(() => [], {}));
    const runtime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => 'https://cdn.invalid/song.mp3'),
      destroy: vi.fn(),
    };
    (manager as unknown as { runtimes: SourceRuntime[] }).runtimes = [runtime as unknown as SourceRuntime];

    await expect(manager.getMusicUrl('kw', '320k', songInfo)).resolves.toBe('https://cdn.invalid/song.mp3');

    expect(runtime.getMusicUrl).toHaveBeenCalledWith('kw', '320k', expect.objectContaining({
      musicId: 'synthetic-id',
      songmid: 'synthetic-id',
    }));
  });

  test('getMusicUrl fails before dispatch when the song has no resolvable id', async () => {
    const manager = new RuntimeManager(fakeSourceManager(() => [], {}));
    const runtime = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => 'https://cdn.invalid/should-not-dispatch.mp3'),
      destroy: vi.fn(),
    };
    (manager as unknown as { runtimes: SourceRuntime[] }).runtimes = [runtime as unknown as SourceRuntime];

    await expect(manager.getMusicUrl('kw', '320k', {
      source: 'kw',
      name: 'No Id Song',
      singer: 'Singer',
      album: '',
      duration: 180,
    }, { operation: 'playback', title: 'No Id Song', artist: 'Singer' })).resolves.toBeNull();

    expect(runtime.getMusicUrl).not.toHaveBeenCalled();
    expect(manager.getLastMusicUrlAttempt()).toEqual({
      attemptedSources: 0,
      lastFailure: '歌曲缺少可解析 ID',
    });
    expect(sourceDiagnostics.list()).toEqual([
      expect.objectContaining({
        operation: 'playback',
        status: 'failed',
        title: 'No Id Song',
        artist: 'Singer',
        platform: 'kw',
        quality: '320k',
        message: '歌曲缺少可解析 ID',
      }),
    ]);
  });

  test('getMusicUrl records failed and successful source diagnostics with source names', async () => {
    const managerSource = fakeSourceManager(() => [sourceMeta('broken-source', true), sourceMeta('working-source', true)], {
      'broken-source': 'broken-script',
      'working-source': 'working-script',
    });
    installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        return result([initedEvent({ kw: {} })]);
      }
      if (name.includes('broken-source')) {
        return result([dispatchErrorEvent(code, 'resolver failed')]);
      }
      return result([dispatchResultEvent(code, 'https://cdn.invalid/working.mp3')]);
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    await expect(manager.getMusicUrl('kw', '320k', songInfo, {
      operation: 'download',
      title: 'Synthetic Song',
      artist: 'Synthetic Artist',
    })).resolves.toBe('https://cdn.invalid/working.mp3');

    expect(sourceDiagnostics.list()).toEqual([
      expect.objectContaining({
        operation: 'download',
        status: 'failed',
        sourceId: 'broken-source',
        sourceName: 'broken-source',
        platform: 'kw',
        message: 'resolver failed',
      }),
      expect.objectContaining({
        operation: 'download',
        status: 'success',
        sourceId: 'working-source',
        sourceName: 'working-source',
        platform: 'kw',
        quality: '320k',
        title: 'Synthetic Song',
        artist: 'Synthetic Artist',
      }),
    ]);
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

  test('close starts destroying every loaded runtime before waiting for the first destroy to settle', async () => {
    const managerSource = fakeSourceManager(
      () => [sourceMeta('enabled-a', true), sourceMeta('enabled-b', true)],
      {
        'enabled-a': 'script-a',
        'enabled-b': 'script-b',
      },
    );
    const { destroy } = installJsenvMock((_name, code, _timeoutMs, waitEvents) => {
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent(code === 'script-a' ? { kw: {} } : { kg: {} })]);
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();

    let releaseFirstDestroy = () => {};
    destroy.mockImplementation((name: string) => {
      if (name.includes('enabled-a')) {
        return new Promise<undefined>((resolve) => {
          releaseFirstDestroy = () => resolve(undefined);
        });
      }

      return Promise.resolve(undefined);
    });

    const close = manager.close();
    await flushMicrotasks();

    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_enabled-a(?:_[a-z0-9]+)?$/));
    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/^starlight_lx_enabled-b(?:_[a-z0-9]+)?$/));
    expect(manager.count()).toBe(0);

    releaseFirstDestroy();
    await expect(close).resolves.toBeUndefined();
  });

  test('close waits for active load and prevents late-published runtimes', async () => {
    const scriptLoad = deferred<string>();
    const getScript = vi.fn(async () => scriptLoad.promise);
    const managerSource = {
      listSources: () => [sourceMeta('enabled-a', true)],
      getScript,
    } as unknown as SourceManager;
    installJsenvMock((_name, _code, _timeoutMs, waitEvents) => {
      expect(waitEvents).toEqual(['inited']);
      return result([initedEvent({ kw: {} })]);
    });
    const manager = new RuntimeManager(managerSource);

    const load = manager.loadEnabledSources();
    await flushMicrotasks();
    expect(getScript).toHaveBeenCalledWith('enabled-a');

    let closeResolved = false;
    const close = manager.close().then(() => {
      closeResolved = true;
    });
    await flushMicrotasks();

    expect(closeResolved).toBe(false);

    scriptLoad.resolve('script-a');
    await expect(load).resolves.toBeUndefined();
    await expect(close).resolves.toBeUndefined();
    expect(closeResolved).toBe(true);
    expect(manager.count()).toBe(0);
  });

  test('getMusicUrl waits for reload to publish the new complete runtime list', async () => {
    let sources = [sourceMeta('old-kw', true)];
    const delayedSecondScript = deferred<string>();
    const getScript = vi.fn(async (id: string) => {
      if (id === 'new-kw') {
        return delayedSecondScript.promise;
      }

      return `${id}-script`;
    });
    const managerSource = {
      listSources: () => sources,
      getScript,
    } as unknown as SourceManager;
    installJsenvMock((name, code, _timeoutMs, waitEvents) => {
      if (waitEvents.includes('inited')) {
        const platform = code.includes('kg') ? 'kg' : 'kw';
        return result([initedEvent({ [platform]: {} })]);
      }

      return result([dispatchResultEvent(code, `https://cdn.invalid/${name}.mp3`)]);
    });
    const manager = new RuntimeManager(managerSource);
    await manager.loadEnabledSources();
    expect(manager.count()).toBe(1);

    sources = [sourceMeta('new-kg', true), sourceMeta('new-kw', true)];
    const reload = manager.loadEnabledSources();
    await waitForMicrotaskCondition(() => getScript.mock.calls.some((call) => call[0] === 'new-kw'));

    expect(getScript).toHaveBeenCalledWith('new-kg');
    expect(getScript).toHaveBeenCalledWith('new-kw');

    let lookupResolved = false;
    const lookup = manager.getMusicUrl('kw', '320k', songInfo).then((url) => {
      lookupResolved = true;
      return url;
    });
    await flushMicrotasks();

    expect(lookupResolved).toBe(false);

    delayedSecondScript.resolve('new-kw-script');
    await expect(reload).resolves.toBeUndefined();
    expect(manager.count()).toBe(2);
    await expect(lookup).resolves.toMatch(
      /^https:\/\/cdn\.invalid\/starlight_lx_new-kw(?:_[a-z0-9]+)?\.mp3$/,
    );
    await expect(manager.getMusicUrl('kg', '320k', songInfo)).resolves.toMatch(
      /^https:\/\/cdn\.invalid\/starlight_lx_new-kg(?:_[a-z0-9]+)?\.mp3$/,
    );
  });
});
