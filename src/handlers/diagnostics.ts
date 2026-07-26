import { parseQuery } from '@songloft/plugin-sdk';
import type { HTTPRequest, Router } from '@songloft/plugin-sdk';
import { sourceDiagnostics, type SourceDiagnosticOperation, type SourceDiagnosticStatus } from '../diagnostics/source_logs';
import { runApi } from '../system/response';

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
    runApi(() => {
      const params = parseQuery(req.query || '');
      const logs = sourceDiagnostics.list({
        operation: operationFilter(params.operation),
        status: statusFilter(params.status),
        limit: limitFilter(params.limit),
      });
      return { logs, total: logs.length };
    }));

  router.post('/api/diagnostics/source-logs/clear', async () =>
    runApi(() => {
      sourceDiagnostics.clear();
      return { ok: true };
    }));
}
