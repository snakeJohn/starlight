import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import type { LxSyncService } from '../lx_sync/service';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface ConfigBody {
  password?: unknown;
  serverName?: unknown;
  enabled?: unknown;
  regeneratePassword?: unknown;
  // legacy remote-server / JSON-import fields — reject
  baseUrl?: unknown;
  username?: unknown;
  token?: unknown;
  conflict?: unknown;
  importDefaultList?: unknown;
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
  if (!(error instanceof StarlightError)) return 500;
  if (error.code === 'BAD_REQUEST') return 400;
  return 500;
}

function parsePlaylistIds(body: ImportSongloftBody): string[] {
  const raw = body.playlist_ids ?? body.playlistIds ?? body.ids;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new StarlightError('BAD_REQUEST', 'playlist_ids must be an array');
  }
  return raw.map((id) => String(id ?? '').trim()).filter(Boolean);
}

export function registerLxSyncHandlers(router: Router, service: LxSyncService): void {
  router.get('/api/lx-sync/config', async () => handle(() => service.getConfig()));

  router.put('/api/lx-sync/config', async (req) =>
    handle(() => {
      const body = parseJsonBody<ConfigBody>(req);
      if (
        body.baseUrl !== undefined ||
        body.username !== undefined ||
        body.token !== undefined ||
        body.conflict !== undefined ||
        body.importDefaultList !== undefined
      ) {
        throw new StarlightError(
          'BAD_REQUEST',
          '洛雪同步已改为本机服务端模式，请在 LX 桌面/移动端填写本页的服务器地址与密钥',
        );
      }
      return service.updateConfig({
        ...(body.password !== undefined ? { password: String(body.password ?? '') } : {}),
        ...(body.serverName !== undefined ? { serverName: String(body.serverName ?? '') } : {}),
        ...(body.enabled !== undefined
          ? { enabled: body.enabled === true || body.enabled === 'true' }
          : {}),
        ...(body.regeneratePassword === true || body.regeneratePassword === 'true'
          ? { regeneratePassword: true }
          : {}),
      });
    }));

  router.post('/api/lx-sync/import-to-songloft', async (req) =>
    handle(() => {
      const body = parseJsonBody<ImportSongloftBody>(req);
      const ids = parsePlaylistIds(body);
      if (!ids.length) {
        throw new StarlightError('BAD_REQUEST', 'playlist_ids is required');
      }
      return service.importToSongloft(ids);
    }));
}
