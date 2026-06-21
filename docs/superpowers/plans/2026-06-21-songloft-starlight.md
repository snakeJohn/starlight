# Songloft Starlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new Songloft JS plugin at `J:\plugins\songloft-plugin-starlight` that combines the MIoT smart speaker plugin with LX Music source import, search, playlist, ranking, URL resolution, and Songloft import/playback bridge features.

**Architecture:** Start from `J:\plugins\songloft-plugin-miot` as the working trunk, keep MIoT behavior intact under `/api/miot/*`, then add focused `system`, `music`, `bridge`, and `ui` domains. Custom LX sources are user-imported only; no source script is bundled or enabled by default.

**Tech Stack:** Songloft JS plugin runtime, QuickJS actor lifecycle, `@songloft/plugin-sdk`, `@songloft/plugin-builder`, TypeScript, plain static HTML/CSS/ES modules, Vitest for local module tests.

---

## Source And Safety Rules

- Never read, copy, package, or reference `J:\lx-music-source-paid-1782020522186.js` from implementation code, tests, fixtures, defaults, logs, or documentation generated during implementation.
- Use `C:\Users\18888\Downloads\LX Music(含魔改版及音源) v26.6.20\LX音源大全(含无损音源及部分音源历史版本)\『直接可用的音源』\星海音乐源 v2.3.5.js` only as a manual acceptance-test import file.
- The shipped plugin must have an empty source list on first run.
- QR login acceptance requires the user to scan manually.

## File Structure

Create or modify these paths:

- Create: `J:\plugins\songloft-plugin-starlight\plugin.json` - Starlight manifest with `entryPath: "starlight"` and `jsenv` permission.
- Create: `J:\plugins\songloft-plugin-starlight\package.json` - build, validate, typecheck, and test scripts.
- Modify: `J:\plugins\songloft-plugin-starlight\src\main.ts` - initialize MIoT, music, bridge, health, routes, and cleanup.
- Create: `J:\plugins\songloft-plugin-starlight\src\router\prefix.ts` - route prefix wrapper for existing MIoT handlers.
- Create: `J:\plugins\songloft-plugin-starlight\src\system\body.ts` - request body parsing.
- Create: `J:\plugins\songloft-plugin-starlight\src\system\errors.ts` - structured error codes and error conversion.
- Create: `J:\plugins\songloft-plugin-starlight\src\system\response.ts` - uniform API envelope helpers.
- Create: `J:\plugins\songloft-plugin-starlight\src\system\locks.ts` - named async locks for imports, index refresh, listeners, and scheduler.
- Create: `J:\plugins\songloft-plugin-starlight\src\system\logger.ts` - log masking helpers.
- Modify: `J:\plugins\songloft-plugin-starlight\src\config\manager.ts` - `starlight:*` storage keys and system log helpers.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\types.ts` - platform, source, song, playlist, leaderboard, and URL types.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\source_store.ts` - persisted custom source metadata and scripts.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\source_manager.ts` - import, list, toggle, delete, and metadata extraction.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\lx_shim.ts` - LX runtime shim for `lx.send`, `lx.request`, and dispatch events.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\runtime.ts` - one `songloft.jsenv` runtime per source.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\runtime_manager.ts` - load enabled sources and resolve `musicUrl`.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\types.ts` - built-in platform provider interface.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\registry.ts` - registers `kw`, `kg`, `tx`, `wy`, `mg`.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\http.ts` - fetch helpers for platform providers.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\kw.ts` - Kuwo provider.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\kg.ts` - Kugou provider.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\tx.ts` - QQ Music provider.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\wy.ts` - Netease provider.
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\mg.ts` - Migu provider.
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\music.ts` - `/api/music/*` routes.
- Create: `J:\plugins\songloft-plugin-starlight\src\bridge\mapper.ts` - LX result to Songloft remote-song mapper.
- Create: `J:\plugins\songloft-plugin-starlight\src\bridge\service.ts` - import, preview URL, speaker playback, and external voice search.
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\bridge.ts` - `/api/bridge/*` routes.
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\health.ts` - `/api/health/*` routes.
- Modify: `J:\plugins\songloft-plugin-starlight\src\voicecmd\online_searcher.ts` - use internal `BridgeService` when external search is enabled.
- Replace: `J:\plugins\songloft-plugin-starlight\static\index.html` - seven-tab Starlight UI shell.
- Create: `J:\plugins\songloft-plugin-starlight\static\js\api.js` - API client using `/api/*`.
- Create: `J:\plugins\songloft-plugin-starlight\static\js\state.js` - shared UI state.
- Create: `J:\plugins\songloft-plugin-starlight\static\js\music.js` - search, sources, songlists, and leaderboards UI logic.
- Create: `J:\plugins\songloft-plugin-starlight\static\js\speaker.js` - account, device, player, and URL playback UI logic.
- Create: `J:\plugins\songloft-plugin-starlight\static\js\automation.js` - schedules, voice commands, indexing UI logic.
- Replace: `J:\plugins\songloft-plugin-starlight\static\css\style.css` - iOS 27 inspired operational UI.
- Create: `J:\plugins\songloft-plugin-starlight\tests\setup.ts` - Songloft runtime mock.
- Create: `J:\plugins\songloft-plugin-starlight\tests\system\*.test.ts` - system primitives tests.
- Create: `J:\plugins\songloft-plugin-starlight\tests\music\*.test.ts` - source manager, runtime, platform, and handler tests.
- Create: `J:\plugins\songloft-plugin-starlight\tests\bridge\*.test.ts` - mapper and bridge service tests.

## Task 1: Scaffold Starlight From MIoT

**Files:**
- Create directory: `J:\plugins\songloft-plugin-starlight`
- Modify: `J:\plugins\songloft-plugin-starlight\plugin.json`
- Modify: `J:\plugins\songloft-plugin-starlight\package.json`
- Modify: `J:\plugins\songloft-plugin-starlight\README.md`

- [ ] **Step 1: Copy MIoT plugin into the new plugin directory**

Run:

```powershell
robocopy 'J:\plugins\songloft-plugin-miot' 'J:\plugins\songloft-plugin-starlight' /E /XD .git node_modules dist build /XF .songloft-dev.json .mimusic-dev.json *.log
if ($LASTEXITCODE -lt 8) { exit 0 } else { exit $LASTEXITCODE }
```

Expected: exit code `0`; `J:\plugins\songloft-plugin-starlight\src\main.ts` exists.

- [ ] **Step 2: Replace `plugin.json` with the Starlight manifest**

Use this exact manifest:

```json
{
  "$schema": "https://raw.githubusercontent.com/songloft-org/plugin-toolchain/main/schemas/plugin.schema.json",
  "name": "Starlight 音乐助手",
  "version": "2026.6.21",
  "description": "智能音箱控制与 LX Music 音源搜索、歌单、榜单、URL 播放桥接插件",
  "author": "Songloft Starlight",
  "homepage": "https://github.com/songloft-org/songloft",
  "license": "Apache-2.0",
  "icon": "icon.svg",
  "entryPath": "starlight",
  "main": "main.js",
  "minHostVersion": "2.0.0",
  "permissions": [
    "storage",
    "songs.read",
    "songs.write",
    "playlists.read",
    "playlists.write",
    "inter-plugin",
    "command",
    "jsenv"
  ],
  "updateUrl": "",
  "download_url": "",
  "entryHash": "",
  "zipHash": ""
}
```

- [ ] **Step 3: Replace package metadata and add future test scripts**

Set `package.json` to:

```json
{
  "name": "songloft-plugin-starlight",
  "version": "2026.6.21",
  "description": "Songloft smart speaker and LX Music source bridge plugin",
  "private": true,
  "scripts": {
    "prebuild": "node scripts/fetch-holidays.mjs",
    "build": "songloft-plugin build",
    "predev": "node scripts/fetch-holidays.mjs",
    "dev": "songloft-plugin dev",
    "validate": "songloft-plugin validate",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "publish:release": "songloft-plugin publish",
    "fetch:holidays": "node scripts/fetch-holidays.mjs"
  },
  "devDependencies": {
    "@songloft/plugin-builder": "^2.4.3",
    "@songloft/plugin-sdk": "^2.4.3",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Update README with project boundaries**

Include these four lines near the top:

```markdown
# songloft-plugin-starlight

Starlight combines MIoT smart speaker control with user-imported LX Music sources.
No music source is bundled or enabled by default.
The Star Sea source is used only as a manual acceptance-test import.
Paid source files are excluded from implementation, tests, bundles, and logs.
```

- [ ] **Step 5: Install dependencies and verify the copied baseline builds**

Run:

```powershell
npm install
npm run typecheck
npm run build
```

Expected: `npm run typecheck` exits `0`; `npm run build` produces `J:\plugins\songloft-plugin-starlight\dist\starlight.jsplugin.zip`.

- [ ] **Step 6: Commit the scaffold**

Run:

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight
git -C 'J:\plugins' commit -m 'feat: scaffold starlight plugin'
```

Expected: commit succeeds and does not include `.superpowers`, `node_modules`, `dist`, or source test music files.

## Task 2: Add Local Test Harness

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\vitest.config.ts`
- Modify: `J:\plugins\songloft-plugin-starlight\tsconfig.json`
- Create: `J:\plugins\songloft-plugin-starlight\tests\setup.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\helpers\songloft.ts`

- [ ] **Step 1: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Include tests in TypeScript compilation context**

Change `tsconfig.json` `include` to:

```json
{
  "include": ["src", "tests", "vitest.config.ts"]
}
```

Keep the existing `compilerOptions`.

- [ ] **Step 3: Create the Songloft mock helper**

Create `tests\helpers\songloft.ts`:

```ts
type StorageMap = Map<string, unknown>;

export function installSongloftMock() {
  const storage: StorageMap = new Map();
  const logs: string[] = [];

  globalThis.songloft = {
    storage: {
      async get(key: string) {
        return storage.has(key) ? storage.get(key) : null;
      },
      async set(key: string, value: unknown) {
        storage.set(key, value);
      },
      async delete(key: string) {
        storage.delete(key);
      },
    },
    log: {
      info: (msg: string) => logs.push(`info:${msg}`),
      warn: (msg: string) => logs.push(`warn:${msg}`),
      error: (msg: string) => logs.push(`error:${msg}`),
      debug: (msg: string) => logs.push(`debug:${msg}`),
    },
    plugin: {
      async getHostUrl() {
        return 'http://127.0.0.1:18191';
      },
      async getToken() {
        return 'test-plugin-token';
      },
    },
    songs: {
      async list() {
        return [];
      },
    },
    jsenv: {
      async create() {
        return {};
      },
      async execute() {
        return { error: '', events: [] };
      },
      async executeWait() {
        return { error: '', events: [] };
      },
      async executeParallel() {
        return { successIndex: -1, errors: ['not mocked'] };
      },
      async destroy() {
        return {};
      },
    },
  } as any;

  return { storage, logs };
}
```

- [ ] **Step 4: Install mock before each test**

Create `tests\setup.ts`:

```ts
import { beforeEach } from 'vitest';
import { installSongloftMock } from './helpers/songloft';

beforeEach(() => {
  installSongloftMock();
});
```

- [ ] **Step 5: Run the empty test suite and typecheck**

Run:

```powershell
npm run typecheck
npm test
```

Expected: typecheck exits `0`; Vitest exits `0` with no failing tests.

- [ ] **Step 6: Commit the test harness**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\package.json songloft-plugin-starlight\package-lock.json songloft-plugin-starlight\tsconfig.json songloft-plugin-starlight\vitest.config.ts songloft-plugin-starlight\tests
git -C 'J:\plugins' commit -m 'test: add starlight test harness'
```

## Task 3: Add System Primitives

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\system\errors.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\system\body.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\system\response.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\system\locks.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\system\logger.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\system\response.test.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\system\locks.test.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\system\logger.test.ts`

- [ ] **Step 1: Write response tests**

Create `tests\system\response.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apiOk, apiError } from '../../src/system/response';
import { StarlightError } from '../../src/system/errors';

describe('API response envelope', () => {
  it('wraps successful data', () => {
    const resp = apiOk({ value: 1 });
    expect(resp.statusCode).toBe(200);
    expect(JSON.parse(resp.body as string)).toEqual({
      success: true,
      data: { value: 1 },
      error: null,
    });
  });

  it('wraps structured errors', () => {
    const resp = apiError(new StarlightError('SOURCE_NOT_ENABLED', '音源未启用', false), 400);
    expect(resp.statusCode).toBe(400);
    expect(JSON.parse(resp.body as string)).toEqual({
      success: false,
      data: null,
      error: {
        code: 'SOURCE_NOT_ENABLED',
        message: '音源未启用',
        retryable: false,
        details: {},
      },
    });
  });
});
```

- [ ] **Step 2: Run response tests and see them fail**

Run:

```powershell
npm test -- tests/system/response.test.ts
```

Expected: fail because `src/system/response.ts` and `src/system/errors.ts` do not exist.

- [ ] **Step 3: Implement structured errors and response helpers**

Create `src\system\errors.ts`:

```ts
export type ErrorCode =
  | 'AUTH_QR_EXPIRED'
  | 'AUTH_PASSWORD_FAILED'
  | 'AUTH_TOKEN_EXPIRED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_NOT_SELECTED'
  | 'PLAY_URL_RESOLVE_FAILED'
  | 'AUDIO_CONVERT_FAILED'
  | 'SOURCE_IMPORT_INVALID'
  | 'SOURCE_RUNTIME_FAILED'
  | 'SOURCE_NOT_ENABLED'
  | 'MUSIC_SEARCH_EMPTY'
  | 'MUSIC_PLATFORM_UNSUPPORTED'
  | 'VOICE_LISTENER_DISABLED'
  | 'VOICE_AI_FAILED'
  | 'EXTERNAL_SEARCH_DISABLED'
  | 'INDEX_REFRESH_RUNNING'
  | 'SCHEDULE_LOCKED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export class StarlightError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StarlightError';
  }
}

export function toStarlightError(error: unknown): StarlightError {
  if (error instanceof StarlightError) return error;
  if (error instanceof Error) return new StarlightError('INTERNAL_ERROR', error.message, false);
  return new StarlightError('INTERNAL_ERROR', String(error), false);
}
```

Create `src\system\response.ts`:

```ts
import type { HTTPResponse } from '@songloft/plugin-sdk';
import { StarlightError, toStarlightError } from './errors';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function apiOk<T>(data: T, statusCode = 200): HTTPResponse {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({ success: true, data, error: null }),
  };
}

export function apiError(error: unknown, statusCode = 500): HTTPResponse {
  const err = error instanceof StarlightError ? error : toStarlightError(error);
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      success: false,
      data: null,
      error: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        details: err.details,
      },
    }),
  };
}

export async function apiHandler<T>(fn: () => Promise<T>, statusCode = 200): Promise<HTTPResponse> {
  try {
    return apiOk(await fn(), statusCode);
  } catch (error) {
    return apiError(error);
  }
}
```

- [ ] **Step 4: Implement body parser**

Create `src\system\body.ts`:

```ts
import type { HTTPRequest } from '@songloft/plugin-sdk';
import { StarlightError } from './errors';

export function parseJsonBody<T = Record<string, unknown>>(req: HTTPRequest): T {
  if (!req.body) return {} as T;
  try {
    const text = typeof req.body === 'string'
      ? req.body
      : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array));
    return JSON.parse(text) as T;
  } catch {
    throw new StarlightError('BAD_REQUEST', '请求体不是合法 JSON', false);
  }
}
```

- [ ] **Step 5: Write and implement lock tests**

Create `tests\system\locks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AsyncLockRegistry } from '../../src/system/locks';

describe('AsyncLockRegistry', () => {
  it('rejects a second holder for the same lock', async () => {
    const locks = new AsyncLockRegistry();
    const release = locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING');
    expect(() => locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING')).toThrow('index-refresh is already running');
    release();
    expect(() => locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING')).not.toThrow();
  });
});
```

Create `src\system\locks.ts`:

```ts
import type { ErrorCode } from './errors';
import { StarlightError } from './errors';

export class AsyncLockRegistry {
  private readonly locks = new Set<string>();

  acquire(name: string, code: ErrorCode): () => void {
    if (this.locks.has(name)) {
      throw new StarlightError(code, `${name} is already running`, true);
    }
    this.locks.add(name);
    return () => {
      this.locks.delete(name);
    };
  }

  isLocked(name: string): boolean {
    return this.locks.has(name);
  }

  clear(): void {
    this.locks.clear();
  }
}
```

- [ ] **Step 6: Write and implement log masking tests**

Create `tests\system\logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { maskSecret, maskRecord } from '../../src/system/logger';

describe('logger masking', () => {
  it('masks secrets but keeps short context', () => {
    expect(maskSecret('abcdef1234567890')).toBe('abcd********7890');
  });

  it('masks known secret fields', () => {
    expect(maskRecord({ api_key: 'sk-1234567890', username: 'admin' })).toEqual({
      api_key: 'sk-1******7890',
      username: 'admin',
    });
  });
});
```

Create `src\system\logger.ts`:

```ts
const SECRET_KEYS = new Set(['password', 'pass_token', 'service_token', 'ssecurity', 'api_key', 'cookie', 'authorization']);

export function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export function maskRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && typeof value === 'string') {
      masked[key] = maskSecret(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
```

- [ ] **Step 7: Run system tests**

Run:

```powershell
npm test -- tests/system
npm run typecheck
```

Expected: all system tests pass; typecheck exits `0`.

- [ ] **Step 8: Commit system primitives**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\system songloft-plugin-starlight\tests\system
git -C 'J:\plugins' commit -m 'feat: add starlight system primitives'
```

## Task 4: Namespace MIoT Routes And Storage

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\router\prefix.ts`
- Modify: `J:\plugins\songloft-plugin-starlight\src\main.ts`
- Modify: `J:\plugins\songloft-plugin-starlight\src\config\manager.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\router\prefix.test.ts`

- [ ] **Step 1: Write prefix router test**

Create `tests\router\prefix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouter, jsonResponse } from '@songloft/plugin-sdk';
import { prefixRouter } from '../../src/router/prefix';

describe('prefixRouter', () => {
  it('prefixes routes without changing handlers', async () => {
    const router = createRouter();
    const miot = prefixRouter(router, '/api/miot');
    miot.get('/auth/status', async () => jsonResponse({ success: true }));
    const resp = await router.handle({ method: 'GET', path: '/api/miot/auth/status', query: '', headers: {} } as any);
    expect(resp.statusCode).toBe(200);
    expect(JSON.parse(resp.body as string)).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Implement route prefix wrapper**

Create `src\router\prefix.ts`:

```ts
import type { Router } from '@songloft/plugin-sdk';

function join(prefix: string, path: string): string {
  const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanPrefix}${cleanPath}`;
}

export function prefixRouter(router: Router, prefix: string): Router {
  return {
    get: (path, handler) => router.get(join(prefix, path), handler),
    post: (path, handler) => router.post(join(prefix, path), handler),
    put: (path, handler) => router.put(join(prefix, path), handler),
    delete: (path, handler) => router.delete(join(prefix, path), handler),
    handle: (req) => router.handle(req),
  } as Router;
}
```

- [ ] **Step 3: Register MIoT handlers under `/api/miot`**

In `src\main.ts`, add:

```ts
import { prefixRouter } from './router/prefix';
```

Before MIoT handler registration, add:

```ts
  const miotRouter = prefixRouter(router, '/api/miot');
```

Change each existing MIoT registration call to use `miotRouter`:

```ts
  registerAccountHandlers(miotRouter, accountManager, authService);
  registerAuthHandlers(miotRouter, authService, accountManager);
  registerDeviceHandlers(miotRouter, minaService, accountManager);
  registerPlaylistHandlers(miotRouter, playlistManagerMap, minaService, configManager);
  registerConfigHandlers(miotRouter, configManager, conversationMonitor, scheduler, voiceEngine);
  registerConversationHandlers(miotRouter, conversationMonitor, configManager);
  registerScheduleHandlers(miotRouter, scheduler, configManager);
  registerVoiceCommandHandlers(miotRouter, configManager);
  registerIndexingHandlers(miotRouter, indexingManager);
```

Change log messages from `MIoT 智能音箱插件` to `Starlight 插件`.

- [ ] **Step 4: Namespace MIoT storage keys**

In `src\config\manager.ts`, replace storage constants with:

```ts
const STORAGE_PREFIX = 'starlight:miot:';
const STORAGE_KEY_CONFIG = STORAGE_PREFIX + 'config';
const STORAGE_KEY_ACCOUNTS = STORAGE_PREFIX + 'accounts';
const STORAGE_KEY_WEBHOOKS = STORAGE_PREFIX + 'webhooks';
const STORAGE_KEY_VOICE_COMMANDS = STORAGE_PREFIX + 'voice_commands';
const STORAGE_KEY_SCHEDULED_TASKS = STORAGE_PREFIX + 'scheduled_tasks';
const STORAGE_KEY_SCHEDULE_LOGS = STORAGE_PREFIX + 'schedule_logs';
const STORAGE_KEY_AI_CONFIG = STORAGE_PREFIX + 'ai_config';
```

- [ ] **Step 5: Run route and build checks**

Run:

```powershell
npm test -- tests/router/prefix.test.ts
npm run typecheck
npm run build
```

Expected: test, typecheck, and build exit `0`.

- [ ] **Step 6: Commit MIoT namespace work**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\router songloft-plugin-starlight\src\main.ts songloft-plugin-starlight\src\config\manager.ts songloft-plugin-starlight\tests\router
git -C 'J:\plugins' commit -m 'feat: namespace miot routes and storage'
```

## Task 5: Implement Music Source Management

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\music\types.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\source_store.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\source_manager.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\music\source_manager.test.ts`

- [ ] **Step 1: Write source manager tests**

Create `tests\music\source_manager.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SourceManager } from '../../src/music/source_manager';
import { SourceStore } from '../../src/music/source_store';

const SCRIPT = `/*!
 * @name 测试音源
 * @version 1.0.0
 * @description 测试用
 * @author tester
 */
lx.send('inited', { sources: { kw: { name: 'kw', type: 'music', actions: ['musicUrl'] } } });`;

describe('SourceManager', () => {
  it('starts with no default sources', async () => {
    const manager = new SourceManager(new SourceStore());
    await manager.init();
    expect(manager.listSources()).toEqual([]);
  });

  it('imports js source disabled by default', async () => {
    const manager = new SourceManager(new SourceStore());
    await manager.init();
    const source = await manager.importFromJS('test-source.js', SCRIPT);
    expect(source.name).toBe('测试音源');
    expect(source.enabled).toBe(false);
    expect(manager.listSources()).toHaveLength(1);
  });

  it('toggles source enabled state', async () => {
    const manager = new SourceManager(new SourceStore());
    await manager.init();
    const source = await manager.importFromJS('test-source.js', SCRIPT);
    await manager.setEnabled(source.id, true);
    expect(manager.listSources()[0].enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Implement music types**

Create `src\music\types.ts`:

```ts
export type MusicPlatform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
export type MusicQuality = '128k' | '320k' | 'flac' | 'flac24bit';

export interface MusicSourceMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  filename: string;
  importedAt: string;
  enabled: boolean;
  supportedPlatforms: string[];
}

export interface MusicSourceScript {
  id: string;
  script: string;
}

export interface LxSongInfo {
  source: string;
  name: string;
  singer: string;
  album: string;
  duration: number;
  musicId?: string;
  songmid?: string;
  hash?: string;
  copyrightId?: string;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string;
  types?: Array<{ type: MusicQuality | string; size?: string }>;
}

export interface SearchResultSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  source_data: {
    platform: MusicPlatform;
    quality: MusicQuality;
    songInfo: LxSongInfo;
  };
}
```

- [ ] **Step 3: Implement source store**

Create `src\music\source_store.ts`:

```ts
import type { MusicSourceMeta } from './types';

const INDEX_KEY = 'starlight:music:sources';
const SCRIPT_PREFIX = 'starlight:music:source_script:';

export class SourceStore {
  async loadIndex(): Promise<MusicSourceMeta[]> {
    const raw = await songloft.storage.get(INDEX_KEY);
    if (!raw) return [];
    if (typeof raw === 'string') return JSON.parse(raw) as MusicSourceMeta[];
    return raw as MusicSourceMeta[];
  }

  async saveIndex(sources: MusicSourceMeta[]): Promise<void> {
    await songloft.storage.set(INDEX_KEY, JSON.stringify(sources));
  }

  async saveScript(id: string, script: string): Promise<void> {
    await songloft.storage.set(SCRIPT_PREFIX + id, script);
  }

  async loadScript(id: string): Promise<string | null> {
    const raw = await songloft.storage.get(SCRIPT_PREFIX + id);
    return typeof raw === 'string' ? raw : null;
  }

  async deleteScript(id: string): Promise<void> {
    await songloft.storage.delete(SCRIPT_PREFIX + id);
  }
}
```

- [ ] **Step 4: Implement source manager**

Create `src\music\source_manager.ts`:

```ts
import { StarlightError } from '../system/errors';
import type { MusicSourceMeta } from './types';
import { SourceStore } from './source_store';

const META_COMMENT = /\/\*[!*][\s\S]*?\*\//;
const META_FIELDS: Record<string, RegExp> = {
  name: /@name\s+(.+)/,
  version: /@version\s+(.+)/,
  description: /@description\s+(.+)/,
  author: /@author\s+(.+)/,
  homepage: /@(?:homepage|repository)\s+(.+)/,
};

function extractMetadata(script: string): Partial<MusicSourceMeta> {
  const match = script.match(META_COMMENT);
  if (!match) return {};
  const comment = match[0];
  const meta: Record<string, string> = {};
  for (const [key, rx] of Object.entries(META_FIELDS)) {
    const field = comment.match(rx);
    if (field?.[1]) meta[key] = field[1].trim();
  }
  return meta;
}

function sourceIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|.]/g, '_')
    .trim();
  return slug || `source-${Date.now()}`;
}

export class SourceManager {
  private sources = new Map<string, MusicSourceMeta>();

  constructor(private readonly store: SourceStore) {}

  async init(): Promise<void> {
    this.sources.clear();
    for (const source of await this.store.loadIndex()) {
      this.sources.set(source.id, source);
    }
  }

  listSources(): MusicSourceMeta[] {
    return Array.from(this.sources.values());
  }

  async importFromJS(filename: string, script: string): Promise<MusicSourceMeta> {
    if (!script.trim()) {
      throw new StarlightError('SOURCE_IMPORT_INVALID', '音源脚本为空', false);
    }
    const meta = extractMetadata(script);
    const name = meta.name || filename.replace(/\.js$/i, '');
    const idBase = sourceIdFromName(name);
    let id = idBase;
    let index = 1;
    while (this.sources.has(id)) {
      index += 1;
      id = `${idBase}-${index}`;
    }
    const source: MusicSourceMeta = {
      id,
      name,
      version: meta.version || '',
      description: meta.description || '',
      author: meta.author || '',
      homepage: meta.homepage || '',
      filename,
      importedAt: new Date().toISOString(),
      enabled: false,
      supportedPlatforms: [],
    };
    this.sources.set(id, source);
    await this.store.saveScript(id, script);
    await this.persist();
    return source;
  }

  async setEnabled(id: string, enabled: boolean): Promise<MusicSourceMeta> {
    const source = this.sources.get(id);
    if (!source) throw new StarlightError('SOURCE_NOT_ENABLED', `音源不存在: ${id}`, false);
    source.enabled = enabled;
    await this.persist();
    return source;
  }

  async deleteSource(id: string): Promise<void> {
    if (!this.sources.has(id)) throw new StarlightError('SOURCE_NOT_ENABLED', `音源不存在: ${id}`, false);
    this.sources.delete(id);
    await this.store.deleteScript(id);
    await this.persist();
  }

  async getScript(id: string): Promise<string | null> {
    return this.store.loadScript(id);
  }

  private async persist(): Promise<void> {
    await this.store.saveIndex(this.listSources());
  }
}
```

- [ ] **Step 5: Run source tests**

```powershell
npm test -- tests/music/source_manager.test.ts
npm run typecheck
```

Expected: source manager tests pass; typecheck exits `0`.

- [ ] **Step 6: Commit source management**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\music songloft-plugin-starlight\tests\music\source_manager.test.ts
git -C 'J:\plugins' commit -m 'feat: add lx source management'
```

## Task 6: Implement LX Runtime And URL Resolution

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\music\lx_shim.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\runtime.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\runtime_manager.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\music\runtime.test.ts`

- [ ] **Step 1: Write runtime tests with mocked jsenv**

Create `tests\music\runtime.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SourceRuntime } from '../../src/music/runtime';

const SCRIPT = `lx.send('inited', { sources: { kw: { actions: ['musicUrl'] } } });`;

describe('SourceRuntime', () => {
  it('loads a source and reads supported platforms', async () => {
    const executeWait = vi.fn().mockResolvedValue({
      error: '',
      events: [{ name: 'inited', data: JSON.stringify({ sources: { kw: { actions: ['musicUrl'] } } }) }],
    });
    (songloft as any).jsenv.executeWait = executeWait;
    const runtime = await SourceRuntime.create('source-a', SCRIPT);
    expect(runtime?.supportsPlatform('kw')).toBe(true);
  });

  it('returns musicUrl dispatch result', async () => {
    let call = 0;
    (songloft as any).jsenv.executeWait = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return { error: '', events: [{ name: 'inited', data: JSON.stringify({ sources: { kw: { actions: ['musicUrl'] } } }) }] };
      }
      return { error: '', events: [{ name: 'dispatchResult', data: JSON.stringify({ id: 'req_1', result: 'https://example.test/a.mp3' }) }] };
    });
    const runtime = await SourceRuntime.create('source-a', SCRIPT);
    const url = await runtime?.getMusicUrl('kw', '320k', { source: 'kw', name: 'a', singer: '', album: '', duration: 0 });
    expect(url).toBe('https://example.test/a.mp3');
  });
});
```

- [ ] **Step 2: Implement LX shim**

Create `src\music\lx_shim.ts`:

```ts
export const LX_SHIM = `
globalThis.lx = {
  env: 'desktop',
  currentScriptInfo: null,
  _listeners: {},
  on(name, handler) {
    this._listeners[name] = handler;
  },
  send(name, data) {
    globalThis.__songloftEmitEvent(name, JSON.stringify(data));
  },
  request(url, options, callback) {
    fetch(url, options || {})
      .then(async response => callback(null, response, await response.text()))
      .catch(error => callback(error, null, null));
  },
  _dispatch(id, event, payload) {
    const handler = this._listeners[event];
    if (!handler) {
      globalThis.__songloftEmitEvent('dispatchError', JSON.stringify({ id, error: 'handler missing' }));
      return;
    }
    Promise.resolve(handler(payload))
      .then(result => globalThis.__songloftEmitEvent('dispatchResult', JSON.stringify({ id, result })))
      .catch(error => globalThis.__songloftEmitEvent('dispatchError', JSON.stringify({ id, error: String(error && error.message || error) })));
  }
};
`;
```

- [ ] **Step 3: Implement source runtime**

Create `src\music\runtime.ts`:

```ts
import { StarlightError } from '../system/errors';
import type { LxSongInfo, MusicQuality } from './types';
import { LX_SHIM } from './lx_shim';

let requestCounter = 0;

export class SourceRuntime {
  private constructor(
    private readonly envName: string,
    private readonly sourceId: string,
    private readonly config: { sources: Record<string, { actions: string[] }> },
  ) {}

  static async create(sourceId: string, script: string): Promise<SourceRuntime | null> {
    const envName = `starlight_lx_${sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await songloft.jsenv.create(envName, LX_SHIM);
    const init = await songloft.jsenv.executeWait(envName, script, 30000, ['inited']);
    if (init.error) {
      await songloft.jsenv.destroy(envName);
      throw new StarlightError('SOURCE_RUNTIME_FAILED', String(init.error), false);
    }
    const event = init.events?.find((item: any) => item.name === 'inited');
    if (!event) {
      await songloft.jsenv.destroy(envName);
      throw new StarlightError('SOURCE_IMPORT_INVALID', '音源未调用 lx.send("inited")', false);
    }
    const config = JSON.parse(event.data);
    return new SourceRuntime(envName, sourceId, config);
  }

  supportsPlatform(platform: string): boolean {
    return Boolean(this.config.sources?.[platform]);
  }

  async getMusicUrl(platform: string, quality: MusicQuality, songInfo: LxSongInfo): Promise<string | null> {
    const requestId = `req_${++requestCounter}`;
    const payload = { source: platform, action: 'musicUrl', info: { musicInfo: songInfo, type: quality } };
    const code = `lx._dispatch(${JSON.stringify(requestId)}, "request", ${JSON.stringify(payload)});`;
    const result = await songloft.jsenv.executeWait(this.envName, code, 30000, ['dispatchResult', 'dispatchError']);
    if (result.error) return null;
    for (const event of result.events || []) {
      const data = JSON.parse(event.data);
      if (data.id !== requestId) continue;
      if (event.name === 'dispatchResult') {
        if (typeof data.result === 'string') return data.result;
        if (data.result && typeof data.result.url === 'string') return data.result.url;
      }
      return null;
    }
    return null;
  }

  async destroy(): Promise<void> {
    await songloft.jsenv.destroy(this.envName);
  }
}
```

- [ ] **Step 4: Implement runtime manager**

Create `src\music\runtime_manager.ts`:

```ts
import { SourceManager } from './source_manager';
import { SourceRuntime } from './runtime';
import type { LxSongInfo, MusicQuality } from './types';

export class RuntimeManager {
  private readonly runtimes = new Map<string, SourceRuntime>();

  constructor(private readonly sourceManager: SourceManager) {}

  async loadEnabledSources(): Promise<void> {
    await this.close();
    for (const source of this.sourceManager.listSources().filter(item => item.enabled)) {
      const script = await this.sourceManager.getScript(source.id);
      if (!script) continue;
      const runtime = await SourceRuntime.create(source.id, script);
      if (runtime) this.runtimes.set(source.id, runtime);
    }
  }

  async getMusicUrl(platform: string, quality: MusicQuality, songInfo: LxSongInfo): Promise<string | null> {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.supportsPlatform(platform)) continue;
      const url = await runtime.getMusicUrl(platform, quality, songInfo);
      if (url) return url;
    }
    return null;
  }

  count(): number {
    return this.runtimes.size;
  }

  async close(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await runtime.destroy();
    }
    this.runtimes.clear();
  }
}
```

- [ ] **Step 5: Run runtime checks**

```powershell
npm test -- tests/music/runtime.test.ts
npm run typecheck
```

Expected: runtime tests pass; typecheck exits `0`.

- [ ] **Step 6: Commit runtime work**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\music\lx_shim.ts songloft-plugin-starlight\src\music\runtime.ts songloft-plugin-starlight\src\music\runtime_manager.ts songloft-plugin-starlight\tests\music\runtime.test.ts
git -C 'J:\plugins' commit -m 'feat: add lx source runtime'
```

## Task 7: Port Built-In Platform Providers And Music Routes

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\types.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\registry.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\http.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\kw.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\kg.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\tx.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\wy.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\music\platforms\providers\mg.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\music.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\music\registry.test.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\music\music_handlers.test.ts`

- [ ] **Step 1: Define provider interface**

Create `src\music\platforms\types.ts`:

```ts
import type { SearchResultSong } from '../types';

export interface SongListSummary {
  id: string;
  name: string;
  cover_url: string;
  play_count: number;
  description: string;
}

export interface LeaderboardBoard {
  id: string;
  name: string;
}

export interface MusicPlatformProvider {
  id: 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
  name: string;
  search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }>;
  songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }>;
  songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }>;
  recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }>;
  leaderboardBoards(): Promise<LeaderboardBoard[]>;
  leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }>;
}
```

- [ ] **Step 2: Implement fetch helper**

Create `src\music\platforms\http.ts`:

```ts
export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await fetchText(url, init)) as T;
}
```

- [ ] **Step 3: Port provider implementations from LX references**

For each provider file, port the matching request, parsing, and item-normalization logic from `J:\plugins\lxserver\src\modules\utils\musicSdk`. Use `J:\plugins\lxmusic.jsplugin\main.js` only to confirm Songloft route behavior and normalized output shape:

```text
kw provider: J:\plugins\lxserver\src\modules\utils\musicSdk\kw\index.js
kg provider: J:\plugins\lxserver\src\modules\utils\musicSdk\kg\index.js
tx provider: J:\plugins\lxserver\src\modules\utils\musicSdk\tx\index.js
wy provider: J:\plugins\lxserver\src\modules\utils\musicSdk\wy\index.js
mg provider: J:\plugins\lxserver\src\modules\utils\musicSdk\mg\index.js
```

Required exports and IDs:

```text
providers\kw.ts -> export class KuwoProvider, id "kw", name "酷我音乐"
providers\kg.ts -> export class KugouProvider, id "kg", name "酷狗音乐"
providers\tx.ts -> export class QQMusicProvider, id "tx", name "QQ音乐"
providers\wy.ts -> export class NeteaseProvider, id "wy", name "网易云音乐"
providers\mg.ts -> export class MiguProvider, id "mg", name "咪咕音乐"
```

Each class must implement the six `MusicPlatformProvider` methods from Step 1. For every returned song, normalize into this shape:

```ts
{
  title: raw.name,
  artist: raw.singer,
  album: raw.album || '',
  duration: Number(raw.duration) || 0,
  cover_url: raw.img || '',
  source_data: {
    platform: provider.id,
    quality: '320k',
    songInfo: {
      source: provider.id,
      name: raw.name,
      singer: raw.singer,
      album: raw.album || '',
      duration: Number(raw.duration) || 0,
      musicId: raw.musicId || '',
      songmid: raw.songmid || raw.musicId || '',
      hash: raw.hash || '',
      copyrightId: raw.copyrightId || '',
      strMediaMid: raw.strMediaMid || '',
      albumMid: raw.albumMid || '',
      albumId: raw.albumId || '',
      types: raw.types || []
    }
  }
}
```

Acceptance rule: no provider method may return a fixed empty result for a supported endpoint unless the upstream platform returns an empty response or a caught request error for that call.

- [ ] **Step 4: Create registry**

Create `src\music\platforms\registry.ts`:

```ts
import type { MusicPlatformProvider } from './types';
import { KuwoProvider } from './providers/kw';
import { KugouProvider } from './providers/kg';
import { QQMusicProvider } from './providers/tx';
import { NeteaseProvider } from './providers/wy';
import { MiguProvider } from './providers/mg';

export class PlatformRegistry {
  private readonly providers = new Map<string, MusicPlatformProvider>();

  constructor() {
    for (const provider of [
      new KuwoProvider(),
      new KugouProvider(),
      new QQMusicProvider(),
      new NeteaseProvider(),
      new MiguProvider(),
    ]) {
      this.providers.set(provider.id, provider);
    }
  }

  all(): Array<{ id: string; name: string }> {
    return Array.from(this.providers.values()).map(({ id, name }) => ({ id, name }));
  }

  get(id: string): MusicPlatformProvider | null {
    return this.providers.get(id) ?? null;
  }
}
```

- [ ] **Step 5: Write registry test**

Create `tests\music\registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PlatformRegistry } from '../../src/music/platforms/registry';

describe('PlatformRegistry', () => {
  it('registers the five required platforms', () => {
    const registry = new PlatformRegistry();
    expect(registry.all().map(item => item.id).sort()).toEqual(['kg', 'kw', 'mg', 'tx', 'wy']);
  });
});
```

- [ ] **Step 6: Implement music HTTP handlers**

Create `src\handlers\music.ts`:

```ts
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import { parseJsonBody } from '../system/body';
import { apiError, apiOk } from '../system/response';
import { StarlightError } from '../system/errors';
import { SourceManager } from '../music/source_manager';
import { RuntimeManager } from '../music/runtime_manager';
import { PlatformRegistry } from '../music/platforms/registry';

export function registerMusicHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
  platforms: PlatformRegistry,
): void {
  router.get('/api/music/platforms', async () => apiOk(platforms.all()));

  router.get('/api/music/sources', async () => apiOk(sources.listSources()));

  router.post('/api/music/sources/import', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<{ filename: string; content: string }>(req);
      const source = await sources.importFromJS(body.filename, body.content);
      return apiOk(source, 201);
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/music/sources/toggle', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<{ id: string; enabled: boolean }>(req);
      const source = await sources.setEnabled(body.id, Boolean(body.enabled));
      await runtimes.loadEnabledSources();
      return apiOk(source);
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/music/search', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<{ keyword: string; source_id: string; page?: number; page_size?: number }>(req);
      const keyword = String(body.keyword || '').trim();
      const provider = platforms.get(String(body.source_id || ''));
      if (!keyword) throw new StarlightError('BAD_REQUEST', 'keyword is required', false);
      if (!provider) throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
      return apiOk(await provider.search(keyword, body.page || 1, body.page_size || 30));
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/music/url', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<any>(req);
      const sourceData = body.source_data;
      if (!sourceData?.platform || !sourceData?.songInfo) {
        throw new StarlightError('BAD_REQUEST', 'source_data.platform and source_data.songInfo are required', false);
      }
      const url = await runtimes.getMusicUrl(sourceData.platform, sourceData.quality || '320k', sourceData.songInfo);
      if (!url) throw new StarlightError('PLAY_URL_RESOLVE_FAILED', '无法解析播放 URL', true);
      return apiOk({ url });
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.get('/api/music/songlist/list', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const provider = platforms.get(String(query.source_id || 'kw'));
      if (!provider) throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
      return apiOk(await provider.recommendedSongLists(Number(query.page || 1), Number(query.page_size || 30)));
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.get('/api/music/leaderboard/boards', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const provider = platforms.get(String(query.source_id || 'kw'));
      if (!provider) throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
      return apiOk(await provider.leaderboardBoards());
    } catch (error) {
      return apiError(error, 400);
    }
  });
}
```

Add the remaining routes in the same file with the exact provider methods:

```text
POST /api/music/songlist/search -> provider.songListSearch(keyword, page, page_size)
GET  /api/music/songlist/detail -> provider.songListDetail(id, page, page_size)
GET  /api/music/leaderboard/list -> provider.leaderboardList(id, page, page_size)
POST /api/music/lyric -> return { lyric: "" } until a provider-specific lyric fetcher returns a lyric
DELETE /api/music/sources/:id -> sources.deleteSource(id), runtimes.loadEnabledSources()
```

- [ ] **Step 7: Register music services in `main.ts`**

Add imports:

```ts
import { SourceStore } from './music/source_store';
import { SourceManager } from './music/source_manager';
import { RuntimeManager } from './music/runtime_manager';
import { PlatformRegistry } from './music/platforms/registry';
import { registerMusicHandlers } from './handlers/music';
```

Add module-level variables:

```ts
let sourceManager: SourceManager;
let runtimeManager: RuntimeManager;
let platformRegistry: PlatformRegistry;
```

In `onInit`, after MIoT services:

```ts
  sourceManager = new SourceManager(new SourceStore());
  await sourceManager.init();
  runtimeManager = new RuntimeManager(sourceManager);
  await runtimeManager.loadEnabledSources();
  platformRegistry = new PlatformRegistry();
```

After MIoT route registration:

```ts
  registerMusicHandlers(router, sourceManager, runtimeManager, platformRegistry);
```

In `onDeinit`:

```ts
  await runtimeManager?.close();
```

- [ ] **Step 8: Run music route checks**

Run:

```powershell
npm test -- tests/music
npm run typecheck
npm run build
```

Expected: tests, typecheck, and build exit `0`.

- [ ] **Step 9: Commit music platform and routes**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\music songloft-plugin-starlight\src\handlers\music.ts songloft-plugin-starlight\src\main.ts songloft-plugin-starlight\tests\music
git -C 'J:\plugins' commit -m 'feat: add music platform APIs'
```

## Task 8: Implement Bridge Service And Voice External Search

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\bridge\mapper.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\bridge\service.ts`
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\bridge.ts`
- Modify: `J:\plugins\songloft-plugin-starlight\src\voicecmd\online_searcher.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\bridge\mapper.test.ts`
- Create: `J:\plugins\songloft-plugin-starlight\tests\bridge\service.test.ts`

- [ ] **Step 1: Write mapper test**

Create `tests\bridge\mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toRemoteSong } from '../../src/bridge/mapper';

describe('toRemoteSong', () => {
  it('maps LX result to Songloft remote song payload', () => {
    const remote = toRemoteSong({
      title: 'Song',
      artist: 'Singer',
      album: 'Album',
      duration: 200,
      cover_url: 'https://img.test/a.jpg',
      source_data: {
        platform: 'kw',
        quality: '320k',
        songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: '123' },
      },
    }, 'https://audio.test/song.mp3');
    expect(remote).toMatchObject({
      title: 'Song',
      artist: 'Singer',
      album: 'Album',
      cover_url: 'https://img.test/a.jpg',
      duration: 200,
      url: 'https://audio.test/song.mp3',
      plugin_entry_path: '',
      dedup_key: 'kw:123',
    });
  });
});
```

- [ ] **Step 2: Implement mapper**

Create `src\bridge\mapper.ts`:

```ts
import type { SearchResultSong } from '../music/types';

export interface RemoteSongPayload {
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  duration: number;
  url: string;
  plugin_entry_path: string;
  source_data: string;
  dedup_key: string;
}

export function toRemoteSong(song: SearchResultSong, url: string): RemoteSongPayload {
  const info = song.source_data.songInfo;
  const id = info.musicId || info.songmid || info.hash || info.copyrightId || '';
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover_url: song.cover_url,
    duration: song.duration,
    url,
    plugin_entry_path: '',
    source_data: JSON.stringify(song.source_data),
    dedup_key: id ? `${song.source_data.platform}:${id}` : '',
  };
}
```

- [ ] **Step 3: Implement bridge service**

Create `src\bridge\service.ts`:

```ts
import { StarlightError } from '../system/errors';
import { PlatformRegistry } from '../music/platforms/registry';
import { RuntimeManager } from '../music/runtime_manager';
import type { SearchResultSong } from '../music/types';
import { toRemoteSong } from './mapper';
import { MinaService } from '../service/service';

export class BridgeService {
  constructor(
    private readonly platforms: PlatformRegistry,
    private readonly runtimes: RuntimeManager,
    private readonly minaService: MinaService,
  ) {}

  async previewUrl(song: SearchResultSong): Promise<string> {
    const url = await this.runtimes.getMusicUrl(song.source_data.platform, song.source_data.quality, song.source_data.songInfo);
    if (!url) throw new StarlightError('PLAY_URL_RESOLVE_FAILED', '无法解析播放 URL', true);
    return url;
  }

  async importSongs(songs: SearchResultSong[]): Promise<{ total: number; payloads: ReturnType<typeof toRemoteSong>[] }> {
    const payloads = [];
    for (const song of songs) {
      const url = await this.previewUrl(song);
      payloads.push(toRemoteSong(song, url));
    }
    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const response = await fetch(`${host}/api/v1/songs/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payloads),
    });
    if (!response.ok) {
      throw new StarlightError('INTERNAL_ERROR', `导入 Songloft 歌曲失败: ${response.status}`, true);
    }
    return { total: payloads.length, payloads };
  }

  async playOnSpeaker(accountId: string, deviceId: string, song: SearchResultSong): Promise<{ url: string }> {
    const url = await this.previewUrl(song);
    const played = await this.minaService.playURL(accountId, deviceId, url);
    if (!played) throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    return { url };
  }

  async externalSearch(keyword: string): Promise<SearchResultSong | null> {
    for (const platform of this.platforms.all()) {
      const provider = this.platforms.get(platform.id);
      if (!provider) continue;
      const result = await provider.search(keyword, 1, 5);
      const first = result.list[0];
      if (first) return first;
    }
    return null;
  }
}
```

- [ ] **Step 4: Implement bridge routes**

Create `src\handlers\bridge.ts`:

```ts
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { parseJsonBody } from '../system/body';
import { apiError, apiOk } from '../system/response';
import { BridgeService } from '../bridge/service';

export function registerBridgeHandlers(router: Router, bridge: BridgeService): void {
  router.post('/api/bridge/preview-url', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<any>(req);
      return apiOk({ url: await bridge.previewUrl(body.song) });
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/bridge/songs/import', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<any>(req);
      return apiOk(await bridge.importSongs(body.songs || []));
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/bridge/play-url', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<any>(req);
      return apiOk(await bridge.playOnSpeaker(body.account_id, body.device_id, body.song));
    } catch (error) {
      return apiError(error, 400);
    }
  });

  router.post('/api/bridge/external-search', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<{ keyword: string }>(req);
      return apiOk(await bridge.externalSearch(body.keyword));
    } catch (error) {
      return apiError(error, 400);
    }
  });
}
```

- [ ] **Step 5: Wire bridge into main and OnlineSearcher**

In `src\main.ts`, import and instantiate:

```ts
import { BridgeService } from './bridge/service';
import { registerBridgeHandlers } from './handlers/bridge';
```

Add variable:

```ts
let bridgeService: BridgeService;
```

After `platformRegistry` and `runtimeManager` initialization:

```ts
  bridgeService = new BridgeService(platformRegistry, runtimeManager, minaService);
```

After route registration:

```ts
  registerBridgeHandlers(router, bridgeService);
```

Modify `src\voicecmd\online_searcher.ts` so constructor accepts an optional `BridgeService`:

```ts
constructor(configManager: ConfigManager, private readonly bridgeService?: BridgeService) {
  this.configManager = configManager;
}
```

At the start of `searchAndPlay`, before external HTTP fetch, add:

```ts
    if (this.bridgeService) {
      const result = await this.bridgeService.externalSearch(keyword);
      if (!result) return false;
      const played = await this.bridgeService.playOnSpeaker(accountId, deviceId, result);
      return Boolean(played.url);
    }
```

- [ ] **Step 6: Run bridge checks**

```powershell
npm test -- tests/bridge
npm run typecheck
npm run build
```

Expected: tests, typecheck, and build exit `0`.

- [ ] **Step 7: Commit bridge**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\bridge songloft-plugin-starlight\src\handlers\bridge.ts songloft-plugin-starlight\src\voicecmd\online_searcher.ts songloft-plugin-starlight\src\main.ts songloft-plugin-starlight\tests\bridge
git -C 'J:\plugins' commit -m 'feat: bridge music search to speaker playback'
```

## Task 9: Build Starlight UI

**Files:**
- Replace: `J:\plugins\songloft-plugin-starlight\static\index.html`
- Replace: `J:\plugins\songloft-plugin-starlight\static\css\style.css`
- Create: `J:\plugins\songloft-plugin-starlight\static\js\api.js`
- Create: `J:\plugins\songloft-plugin-starlight\static\js\state.js`
- Create: `J:\plugins\songloft-plugin-starlight\static\js\music.js`
- Create: `J:\plugins\songloft-plugin-starlight\static\js\speaker.js`
- Create: `J:\plugins\songloft-plugin-starlight\static\js\automation.js`
- Modify: `J:\plugins\songloft-plugin-starlight\static\js\app.js`

- [ ] **Step 1: Replace HTML shell with seven tabs**

`static\index.html` must include these root regions:

```html
<body>
  <div class="app-shell">
    <aside class="side-rail" id="sideRail"></aside>
    <main class="workspace">
      <header class="status-strip" id="statusStrip"></header>
      <section class="tab-panel active" id="tab-search"></section>
      <section class="tab-panel" id="tab-speaker"></section>
      <section class="tab-panel" id="tab-songlists"></section>
      <section class="tab-panel" id="tab-rankings"></section>
      <section class="tab-panel" id="tab-sources"></section>
      <section class="tab-panel" id="tab-automation"></section>
      <section class="tab-panel" id="tab-settings"></section>
      <footer class="mini-player" id="miniPlayer"></footer>
    </main>
    <nav class="bottom-tabs" id="bottomTabs"></nav>
  </div>
  <script type="module" src="static/js/app.js"></script>
</body>
```

- [ ] **Step 2: Implement API client**

Create `static\js\api.js`:

```js
const BASE = 'api';

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!payload.success) {
    const error = new Error(payload.error?.message || '请求失败');
    error.code = payload.error?.code;
    error.retryable = payload.error?.retryable;
    throw error;
  }
  return payload.data;
}

export const api = {
  get: path => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
  delete: path => request(path, { method: 'DELETE' }),
};
```

- [ ] **Step 3: Implement state module**

Create `static\js\state.js`:

```js
export const state = {
  activeTab: 'search',
  accountId: '',
  deviceId: '',
  platform: 'kw',
  quality: '320k',
  searchResults: [],
  sources: [],
};

export function setState(patch) {
  Object.assign(state, patch);
  window.dispatchEvent(new CustomEvent('starlight:state', { detail: patch }));
}
```

- [ ] **Step 4: Implement music UI module**

Create `static\js\music.js` with functions:

```js
import { api } from './api.js';
import { state, setState } from './state.js';

export async function initMusicUI() {
  await loadPlatforms();
  await loadSources();
  bindSearch();
  bindSourceImport();
}

async function loadPlatforms() {
  const platforms = await api.get('/music/platforms');
  const select = document.querySelector('[data-role="platform-select"]');
  if (!select) return;
  select.innerHTML = platforms.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
}

async function loadSources() {
  const sources = await api.get('/music/sources');
  setState({ sources });
  const list = document.querySelector('[data-role="source-list"]');
  if (!list) return;
  list.innerHTML = sources.length
    ? sources.map(item => `<button class="source-row" data-source-id="${item.id}">${item.name}<span>${item.enabled ? '已启用' : '未启用'}</span></button>`).join('')
    : '<div class="empty-state">暂无音源，请导入自己的 LX 音源 js 或 zip 包。</div>';
}

function bindSearch() {
  const form = document.querySelector('[data-role="music-search-form"]');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const keyword = form.querySelector('[name="keyword"]').value.trim();
    const source_id = form.querySelector('[name="source_id"]').value;
    const data = await api.post('/music/search', { keyword, source_id, page: 1, page_size: 30 });
    setState({ searchResults: data.list || [] });
    renderSearchResults();
  });
}

function renderSearchResults() {
  const list = document.querySelector('[data-role="search-results"]');
  if (!list) return;
  list.innerHTML = state.searchResults.map((song, index) => `
    <article class="song-row">
      <div><strong>${song.title}</strong><span>${song.artist} · ${song.album || '未知专辑'}</span></div>
      <button data-action="preview" data-index="${index}">试听</button>
      <button data-action="import" data-index="${index}">导入</button>
      <button data-action="speaker" data-index="${index}">音箱播放</button>
    </article>
  `).join('');
}

function bindSourceImport() {
  const input = document.querySelector('[data-role="source-file"]');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const content = await file.text();
    await api.post('/music/sources/import', { filename: file.name, content });
    await loadSources();
  });
}
```

- [ ] **Step 5: Implement speaker and automation modules**

`static\js\speaker.js` must call:

```text
GET  /miot/auth/status
POST /miot/auth/login
POST /miot/auth/token
POST /miot/auth/qrcode
POST /miot/auth/qrcode/poll
GET  /miot/mina/devices
POST /miot/mina/volume
POST /miot/mina/play-url
POST /miot/player/previous
POST /miot/player/next
POST /miot/player/stop
POST /miot/player/mode
```

`static\js\automation.js` must call:

```text
GET  /miot/voice-commands
PUT  /miot/voice-commands
GET  /miot/schedules
POST /miot/schedules/update
POST /miot/schedules/toggle
GET  /miot/indexing/status
POST /miot/indexing/refresh
GET  /miot/config
PUT  /miot/config
```

Each request uses `api.get`, `api.post`, or `api.put` from `api.js`.

- [ ] **Step 6: Implement responsive CSS**

Replace `static\css\style.css` with CSS that includes:

```css
:root {
  color-scheme: light dark;
  --surface-glass: color-mix(in srgb, var(--sl-color-surface, #fff) 78%, transparent);
  --surface-line: color-mix(in srgb, var(--sl-color-border, #d0d7de) 70%, transparent);
  --accent: var(--sl-color-primary, #0a84ff);
}

body {
  margin: 0;
  font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--sl-color-background, #f6f7f9);
  color: var(--sl-color-text, #111827);
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
}

.side-rail,
.status-strip,
.mini-player {
  background: var(--surface-glass);
  backdrop-filter: blur(18px);
  border-color: var(--surface-line);
}

.tab-panel {
  display: none;
  padding: 18px;
}

.tab-panel.active {
  display: block;
}

.song-row,
.source-row {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
}

@media (max-width: 760px) {
  .app-shell {
    grid-template-columns: 1fr;
    padding-bottom: 72px;
  }

  .side-rail {
    display: none;
  }

  .bottom-tabs {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  .song-row,
  .source-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 7: Wire app initialization**

Modify `static\js\app.js` so `DOMContentLoaded` calls:

```js
import { initMusicUI } from './music.js';
import { initSpeakerUI } from './speaker.js';
import { initAutomationUI } from './automation.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initMusicUI();
  await initSpeakerUI();
  await initAutomationUI();
});
```

Keep existing MIoT helper modules only if they are still imported and used by the new shell. Remove Tracely configuration from Starlight UI unless the user supplies valid credentials separately.

- [ ] **Step 8: Build and inspect UI**

Run:

```powershell
npm run build
```

Then run dev upload against the test host when credentials are available:

```powershell
npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin
```

Expected: build exits `0`; dev prints a plugin URL containing `/api/v1/jsplugin/starlight/`.

- [ ] **Step 9: Commit UI**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\static
git -C 'J:\plugins' commit -m 'feat: add starlight web ui'
```

## Task 10: Add Health Routes And Acceptance Checklist

**Files:**
- Create: `J:\plugins\songloft-plugin-starlight\src\handlers\health.ts`
- Modify: `J:\plugins\songloft-plugin-starlight\src\main.ts`
- Create: `J:\plugins\songloft-plugin-starlight\docs\acceptance.md`

- [ ] **Step 1: Implement health routes**

Create `src\handlers\health.ts`:

```ts
import type { Router } from '@songloft/plugin-sdk';
import { apiOk } from '../system/response';
import { SourceManager } from '../music/source_manager';
import { RuntimeManager } from '../music/runtime_manager';

export function registerHealthHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
): void {
  router.get('/api/health/summary', async () => apiOk({
    source_count: sources.listSources().length,
    enabled_source_count: sources.listSources().filter(item => item.enabled).length,
    loaded_runtime_count: runtimes.count(),
  }));

  router.get('/api/health/logs', async () => apiOk([]));
  router.post('/api/health/logs/clear', async () => apiOk({ cleared: true }));
}
```

Register in `main.ts`:

```ts
import { registerHealthHandlers } from './handlers/health';
```

After bridge routes:

```ts
  registerHealthHandlers(router, sourceManager, runtimeManager);
```

- [ ] **Step 2: Write acceptance document**

Create `docs\acceptance.md` with these sections:

```markdown
# Starlight Acceptance Checklist

## Build

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run validate`

## Test Environment

- Host: `http://192.168.31.63:18191/`
- Songloft login: `admin/admin`
- Plugin entry: `/api/v1/jsplugin/starlight/`

## Source Rules

- First run shows zero music sources.
- Star Sea source is manually imported from the user-provided download path for testing.
- Paid source file is not read, copied, bundled, logged, or configured.

## Manual QR Login

- Start QR login in the UI.
- User scans QR code.
- Polling returns success.
- Device list loads after login.

## Main Flow

- Import and enable Star Sea source.
- Search a song.
- Resolve preview URL.
- Import result into Songloft.
- Push result to selected smart speaker.
- Enable conversation listener.
- Test rule voice command.
- Test external search fallback after local index miss.
```

- [ ] **Step 3: Run full local verification**

```powershell
npm run typecheck
npm test
npm run build
npm run validate
```

Expected: all commands exit `0`.

- [ ] **Step 4: Commit health and acceptance docs**

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight\src\handlers\health.ts songloft-plugin-starlight\src\main.ts songloft-plugin-starlight\docs\acceptance.md
git -C 'J:\plugins' commit -m 'feat: add health routes and acceptance checklist'
```

## Task 11: End-To-End Manual Verification

**Files:**
- Modify only if verification exposes a defect in files created by earlier tasks.

- [ ] **Step 1: Start development upload**

Run:

```powershell
npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin
```

Expected: console prints `/api/v1/jsplugin/starlight/`.

- [ ] **Step 2: Open plugin UI**

Open:

```text
http://192.168.31.63:18191/api/v1/jsplugin/starlight/
```

Expected: Search tab is first, no default source is listed, no UI text overlaps at desktop width.

- [ ] **Step 3: Verify Star Sea source manual import**

In the UI, import:

```text
C:\Users\18888\Downloads\LX Music(含魔改版及音源) v26.6.20\LX音源大全(含无损音源及部分音源历史版本)\『直接可用的音源』\星海音乐源 v2.3.5.js
```

Expected: source appears after import and remains disabled until the user enables it.

- [ ] **Step 4: Verify search to playback bridge**

Use the UI:

```text
平台: 酷我 or 酷狗
关键词: 任意可公开搜索歌曲名
操作: 搜索 -> 试听 -> 导入 Songloft -> 音箱播放
```

Expected: search returns rows, URL resolves, import succeeds, selected speaker receives playback URL.

- [ ] **Step 5: Verify MIoT login modes**

Use the UI:

```text
扫码登录: user scans QR code manually
账密登录: submit username/password and captcha/verify code if required
Token 登录: submit user_id and pass_token
```

Expected: each successful mode appears in auth status without exposing raw token values in UI or logs.

- [ ] **Step 6: Verify smart speaker control**

Use the UI:

```text
音量绝对设置
音量增加
音量减小
上一首
下一首
停止
播放模式切换
指示灯开关
URL 播放
时区设置
自定义 Music API 型号
```

Expected: API calls return `success: true` or a structured error with a specific code.

- [ ] **Step 7: Verify voice and automation**

Use the UI:

```text
开启对话监听
配置播放歌曲口令
配置播放歌单口令
开启外部搜索
触发本地索引未命中的歌名
创建一次定时任务
查看定时任务日志
```

Expected: listener starts once, commands execute once, external search calls the internal bridge only when enabled, scheduler does not duplicate tasks after plugin reload.

- [ ] **Step 8: Verify mobile layout**

Open browser responsive view at `390x844`.

Expected:

```text
底部 Tab 可见
搜索页按钮不溢出
音源页空状态和导入控件不重叠
音箱控制页音量控件可操作
自动化页表单可滚动
```

- [ ] **Step 9: Final verification and commit**

Run:

```powershell
npm run typecheck
npm test
npm run build
npm run validate
git -C 'J:\plugins' status --short
```

Expected: all commands exit `0`; git status shows only intentional changes.

Commit any verification fixes:

```powershell
git -C 'J:\plugins' add -- songloft-plugin-starlight
git -C 'J:\plugins' commit -m 'fix: address starlight acceptance findings'
```

## Self-Review

- Spec coverage: architecture, MIoT login/control, voice commands, external search, LX source import, songs, songlists, leaderboards, bridge playback, UI, safety boundaries, and tests are covered by Tasks 1-11.
- Placeholder scan: this plan uses concrete file paths, commands, data shapes, and acceptance expectations.
- Type consistency: shared names are `SourceManager`, `RuntimeManager`, `PlatformRegistry`, `BridgeService`, `SearchResultSong`, `apiOk`, `apiError`, and `StarlightError` across tasks.
- Scope: one plugin is built in phases with frequent commits; no paid source is imported or bundled; Star Sea source remains manual-test-only.
