type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type AsyncFunction<T = unknown> = (...args: unknown[]) => Promise<T>;

interface JsenvExecutionResult {
  error: string;
  events: unknown[];
}

interface TestSongloft {
  storage: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    keys(): Promise<string[]>;
  };
  log: Record<LogLevel, (...args: unknown[]) => void>;
  plugin: {
    getHostUrl(): Promise<string>;
    getToken(): Promise<string>;
    getFileUrl: AsyncFunction<string>;
  };
  songs: {
    list: AsyncFunction<unknown[]>;
    getById: AsyncFunction;
    search: AsyncFunction<unknown[]>;
  };
  jsenv: {
    create: AsyncFunction<Record<string, never>>;
    execute: AsyncFunction<JsenvExecutionResult>;
    executeWait: AsyncFunction<JsenvExecutionResult>;
    executeParallel: AsyncFunction<{ successIndex: number; errors: string[] }>;
    destroy: AsyncFunction<Record<string, never>>;
  };
  playlists: Record<string, AsyncFunction>;
  comm: Record<string, AsyncFunction>;
  fs: Record<string, AsyncFunction>;
  command: Record<string, AsyncFunction>;
}

const formatLogArgs = (args: unknown[]): string => args.map((arg) => String(arg)).join(' ');
const unmockedAsync =
  (name: string): AsyncFunction<never> =>
  async () => {
    throw new Error(`Unmocked songloft.${name} call. Configure it in this test.`);
  };

const unmockedSurface = (surface: string, methods: string[]): Record<string, AsyncFunction> =>
  Object.fromEntries(methods.map((method) => [method, unmockedAsync(`${surface}.${method}`)]));

export function installSongloftMock() {
  const storage = new Map<string, unknown>();
  const logs: string[] = [];

  const writeLog =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      logs.push(`[${level}] ${formatLogArgs(args)}`);
    };

  const blockedFetch: typeof fetch = async () => {
    throw new Error('Unexpected fetch call. Mock globalThis.fetch in this test.');
  };

  const songloft: TestSongloft = {
    storage: {
      get: async (key: string) => storage.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => storage.delete(key),
      keys: async () => Array.from(storage.keys()),
    },
    log: {
      info: writeLog('info'),
      warn: writeLog('warn'),
      error: writeLog('error'),
      debug: writeLog('debug'),
    },
    plugin: {
      getHostUrl: async () => 'http://127.0.0.1:18191',
      getToken: async () => 'test-plugin-token',
      getFileUrl: unmockedAsync('plugin.getFileUrl'),
    },
    songs: {
      list: async () => [],
      getById: unmockedAsync('songs.getById'),
      search: unmockedAsync('songs.search'),
    },
    jsenv: {
      create: async () => ({}),
      execute: async () => ({ error: '', events: [] }),
      executeWait: async () => ({ error: '', events: [] }),
      executeParallel: async () => ({ successIndex: -1, errors: ['not mocked'] }),
      destroy: async () => ({}),
    },
    playlists: unmockedSurface('playlists', ['list', 'getSongs', 'getById', 'search']),
    comm: unmockedSurface('comm', ['request', 'send', 'subscribe', 'unsubscribe']),
    fs: unmockedSurface('fs', ['readFile', 'writeFile', 'delete', 'exists', 'list', 'mkdir']),
    command: unmockedSurface('command', ['register', 'unregister', 'execute']),
  };

  globalThis.fetch = blockedFetch;
  (globalThis as typeof globalThis & { songloft: TestSongloft }).songloft = songloft;

  return { storage, logs };
}
