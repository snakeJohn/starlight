import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import type { LxSyncService } from '../lx_sync/service';
import type { LxSyncConflict } from '../lx_sync/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface ConnectBody {
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
}

interface ConfigBody {
  baseUrl?: unknown;
  username?: unknown;
  importDefaultList?: unknown;
  conflict?: unknown;
  password?: unknown;
}

interface ImportSongloftBody {
  playlist_ids?: unknown;
  playlistIds?: unknown;
  ids?: unknown;
}

function handle(fn: () => unknown | Promise<unknown>, statusCode = 200): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data, statusCode))
    .catch((error) => apiError(error, statusFor(error)));
}

function statusFor(error: unknown): number {
  if (!(error instanceof StarlightError)) {
    return 500;
  }
  if (error.code === 'BAD_REQUEST') {
    return 400;
  }
  if (error.code === 'AUTH_PASSWORD_FAILED' || error.code === 'AUTH_TOKEN_EXPIRED') {
    return 401;
  }
  return 500;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireString(value: unknown, name: string): string {
  const text = stringField(value);
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }
  return text;
}

function parseConflict(value: unknown): LxSyncConflict | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'merge' || value === 'replace') return value;
  throw new StarlightError('BAD_REQUEST', 'conflict must be replace or merge');
}

function parsePlaylistIds(body: ImportSongloftBody): string[] {
  const raw = body.playlist_ids ?? body.playlistIds ?? body.ids;
  if (!Array.isArray(raw)) {
    throw new StarlightError('BAD_REQUEST', 'playlist_ids is required');
  }
  return raw.map((id) => String(id ?? '').trim()).filter(Boolean);
}

export function registerLxSyncHandlers(router: Router, service: LxSyncService): void {
  router.get('/api/lx-sync/config', async () => handle(() => service.getConfig()));

  router.put('/api/lx-sync/config', async (req) =>
    handle(() => {
      const body = parseJsonBody<ConfigBody>(req);
      // Password must never be accepted/stored via config PUT.
      if (body.password !== undefined) {
        throw new StarlightError('BAD_REQUEST', 'password cannot be saved via config; use connect');
      }
      return service.updateConfig({
        ...(body.baseUrl !== undefined ? { baseUrl: stringField(body.baseUrl) } : {}),
        ...(body.username !== undefined ? { username: stringField(body.username) } : {}),
        ...(body.importDefaultList !== undefined ? { importDefaultList: body.importDefaultList === true || body.importDefaultList === 'true' } : {}),
        ...(body.conflict !== undefined ? { conflict: parseConflict(body.conflict) } : {}),
      });
    }));

  router.post('/api/lx-sync/connect', async (req) =>
    handle(() => {
      const body = parseJsonBody<ConnectBody>(req);
      return service.connect({
        baseUrl: requireString(body.baseUrl, 'baseUrl'),
        username: requireString(body.username, 'username'),
        password: typeof body.password === 'string' ? body.password : requireString(body.password, 'password'),
      });
    }));

  router.post('/api/lx-sync/disconnect', async () => handle(() => service.disconnect()));

  router.post('/api/lx-sync/pull', async () => handle(() => service.pull()));

  router.get('/api/lx-sync/preview', async () => handle(() => service.preview()));

  router.post('/api/lx-sync/import-to-songloft', async (req) =>
    handle(() => {
      const body = parseJsonBody<ImportSongloftBody>(req);
      return service.importToSongloft(parsePlaylistIds(body));
    }));
}
