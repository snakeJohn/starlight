import type { Router } from '@songloft/plugin-sdk';
import { SourceManager } from '../music/source_manager';
import { RuntimeManager } from '../music/runtime_manager';
import { apiOk } from '../system/response';

export function registerHealthHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
): void {
  router.get('/api/health/summary', async () => apiOk({
    source_count: sources.listSources().length,
    enabled_source_count: sources.listSources().filter((item) => item.enabled).length,
    loaded_runtime_count: runtimes.count(),
  }));

  router.get('/api/health/logs', async () => apiOk([]));
  router.post('/api/health/logs/clear', async () => apiOk({ cleared: true }));
}
