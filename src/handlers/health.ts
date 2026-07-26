import type { Router } from '@songloft/plugin-sdk';
import { sourceDiagnostics } from '../diagnostics/source_logs';
import { SourceManager } from '../music/source_manager';
import { RuntimeManager } from '../music/runtime_manager';
import { runApi } from '../system/response';

export function registerHealthHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
): void {
  router.get('/api/health/summary', async () => runApi(() => ({
    source_count: sources.listSources().length,
    enabled_source_count: sources.listSources().filter((item) => item.enabled).length,
    loaded_runtime_count: runtimes.count(),
  })));

  // Alias of diagnostics source logs for older clients / health probes.
  router.get('/api/health/logs', async () => runApi(() => {
    const logs = sourceDiagnostics.list({ limit: 100 });
    return { logs, total: logs.length };
  }));

  router.post('/api/health/logs/clear', async () => runApi(() => {
    sourceDiagnostics.clear();
    return { cleared: true };
  }));
}
