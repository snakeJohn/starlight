type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const formatLogArgs = (args: unknown[]): string => args.map((arg) => String(arg)).join(' ');

export function installSongloftMock() {
  const storage = new Map<string, unknown>();
  const logs: string[] = [];

  const writeLog =
    (level: LogLevel) =>
    async (...args: unknown[]): Promise<void> => {
      logs.push(`[${level}] ${formatLogArgs(args)}`);
    };

  (globalThis as any).songloft = {
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => storage.delete(key),
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
    },
    songs: {
      list: async () => [],
    },
    jsenv: {
      create: async () => '',
      execute: async () => undefined,
      executeWait: async () => undefined,
      executeParallel: async () => [],
      destroy: async () => undefined,
    },
  };

  return { storage, logs };
}
