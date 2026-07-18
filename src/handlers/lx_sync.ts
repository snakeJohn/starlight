import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import type { LxSyncService } from '../lx_sync/service';
import type { LxSyncConflict } from '../lx_sync/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface ConfigBody {
  importDefaultList?: unknown;
  conflict?: unknown;
  // legacy fields — reject if used as credentials
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
  token?: unknown;
}

interface PayloadBody {
  listData?: unknown;
  data?: unknown;
  payload?: unknown;
  json?: unknown;
  importDefaultList?: unknown;
  conflict?: unknown;
}

interface ExportBody {
  playlist_ids?: unknown;
  playlistIds?: unknown;
  ids?: unknown;
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
  return 500;
}

function parseConflict(value: unknown): LxSyncConflict | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'merge' || value === 'replace') return value;
  throw new StarlightError('BAD_REQUEST', 'conflict must be replace or merge');
}

function extractPayload(body: PayloadBody | unknown): unknown {
  if (body === null || body === undefined) {
    throw new StarlightError('BAD_REQUEST', 'listData JSON is required');
  }
  if (typeof body === 'string') {
    return body;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const record = body as PayloadBody;
  if (record.listData !== undefined) return record.listData;
  if (record.payload !== undefined) return record.payload;
  if (record.json !== undefined) return record.json;
  if (record.data !== undefined) return record.data;
  // Allow posting the ListData object itself at the root.
  return body;
}

function parsePlaylistIds(body: ExportBody | ImportSongloftBody): string[] {
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
        body.password !== undefined ||
        body.token !== undefined
      ) {
        throw new StarlightError(
          'BAD_REQUEST',
          '洛雪歌单同步不再使用远程服务器账号，请粘贴/导入 LX 列表 JSON',
        );
      }
      return service.updateConfig({
        ...(body.importDefaultList !== undefined
          ? { importDefaultList: body.importDefaultList === true || body.importDefaultList === 'true' }
          : {}),
        ...(body.conflict !== undefined ? { conflict: parseConflict(body.conflict) } : {}),
      });
    }));

  router.post('/api/lx-sync/preview', async (req) =>
    handle(() => {
      const body = parseJsonBody<PayloadBody>(req);
      return service.preview(extractPayload(body), {
        ...(body.importDefaultList !== undefined
          ? { importDefaultList: body.importDefaultList === true || body.importDefaultList === 'true' }
          : {}),
      });
    }));

  router.post('/api/lx-sync/import', async (req) =>
    handle(() => {
      const body = parseJsonBody<PayloadBody>(req);
      return service.importList(extractPayload(body), {
        ...(body.importDefaultList !== undefined
          ? { importDefaultList: body.importDefaultList === true || body.importDefaultList === 'true' }
          : {}),
        ...(body.conflict !== undefined ? { conflict: parseConflict(body.conflict) } : {}),
      });
    }));

  // Backward-compatible alias of import (old "pull" name).
  router.post('/api/lx-sync/pull', async (req) =>
    handle(() => {
      const body = parseJsonBody<PayloadBody>(req);
      return service.importList(extractPayload(body), {
        ...(body.importDefaultList !== undefined
          ? { importDefaultList: body.importDefaultList === true || body.importDefaultList === 'true' }
          : {}),
        ...(body.conflict !== undefined ? { conflict: parseConflict(body.conflict) } : {}),
      });
    }));

  router.post('/api/lx-sync/export', async (req) =>
    handle(() => {
      const body = parseJsonBody<ExportBody>(req);
      const ids = parsePlaylistIds(body);
      return service.exportList(ids.length ? ids : undefined);
    }));

  router.get('/api/lx-sync/export', async (req) =>
    handle(() => {
      const query = String(req.query || '');
      const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
      const rawIds = params.getAll('playlist_ids').concat(params.get('ids')?.split(',') || []).filter(Boolean);
      return service.exportList(rawIds.length ? rawIds : undefined);
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
