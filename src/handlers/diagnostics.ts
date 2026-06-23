import { parseQuery } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, Router } from '@songloft/plugin-sdk';
import { sourceDiagnostics, type SourceDiagnosticOperation, type SourceDiagnosticStatus } from '../diagnostics/source_logs';
import { apiError, apiOk } from '../system/response';

function handle(fn: () => unknown | Promise<unknown>): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data))
    .catch((error) => apiError(error));
}

function operationFilter(value: unknown): SourceDiagnosticOperation | 'all' {
  return value === 'playback' || value === 'download' ? value : 'all';
}

function statusFilter(value: unknown): SourceDiagnosticStatus | 'all' {
  return value === 'success' || value === 'failed' ? value : 'all';
}

function limitFilter(value: unknown): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 300;
}

export function registerDiagnosticsHandlers(router: Router): void {
  router.get('/api/diagnostics/source-logs', async (req: HTTPRequest) =>
    handle(() => {
      const params = parseQuery(req.query || '');
      const logs = sourceDiagnostics.list({
        operation: operationFilter(params.operation),
        status: statusFilter(params.status),
        limit: limitFilter(params.limit),
      });
      return { logs, total: logs.length };
    }));

  router.post('/api/diagnostics/source-logs/clear', async () =>
    handle(() => {
      sourceDiagnostics.clear();
      return { ok: true };
    }));
}
