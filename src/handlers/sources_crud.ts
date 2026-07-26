import type { Router } from '@songloft/plugin-sdk';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SourceImportFile, SourceManager } from '../music/source_manager';
import { parseJsonBody } from '../system/body';
import { boolField, objectField, requireId } from '../system/fields';
import { StarlightError } from '../system/errors';
import { runApi } from '../system/response';

interface SourceImportBody {
  filename?: unknown;
  content?: unknown;
  files?: unknown;
}

interface SourceToggleBody {
  id?: unknown;
  enabled?: unknown;
}

interface SourceBatchToggleBody {
  ids?: unknown;
  enabled?: unknown;
}

export interface SourceCrudOptions {
  /** Route prefix without trailing slash, e.g. `/api/music/sources` or `/api/download/sources`. */
  prefix: string;
  sources: SourceManager;
  runtimes: RuntimeManager;
  /** Label used in runtime-reload warning logs. */
  runtimeLabel: string;
}

function sourceImportFiles(value: unknown): SourceImportFile[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'files must be an array');
  }

  return value.map((entry) => {
    const source = objectField(entry);
    if (!source) {
      throw new StarlightError('BAD_REQUEST', 'files entries must be objects');
    }
    const filename = requireId(source.filename, 'filename');
    const content = typeof source.content === 'string' ? source.content : '';
    if (!content) {
      throw new StarlightError('BAD_REQUEST', 'content is required');
    }
    return { filename, content };
  });
}

function sourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'ids must be an array');
  }
  const ids = value.map((entry) => requireId(entry));
  if (ids.length === 0) {
    throw new StarlightError('BAD_REQUEST', 'ids must not be empty');
  }
  return ids;
}

function reloadRuntimesInBackground(runtimes: RuntimeManager, label: string): void {
  runtimes.loadEnabledSources().catch((error) => {
    songloft.log.warn(`Failed to reload ${label} source runtimes: ${String(error)}`);
  });
}

/**
 * Register identical source list / import / toggle / delete routes for
 * playback (`/api/music/sources`) and download (`/api/download/sources`).
 */
export function registerSourceCrudRoutes(router: Router, options: SourceCrudOptions): void {
  const { prefix, sources, runtimes, runtimeLabel } = options;

  router.get(prefix, async () => runApi(() => sources.listSources()));

  router.post(`${prefix}/import`, async (req) =>
    runApi(async () => {
      const body = parseJsonBody<SourceImportBody>(req);
      if (body.files !== undefined) {
        return sources.importManyFromJS(sourceImportFiles(body.files));
      }

      const filename = requireId(body.filename, 'filename');
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content) {
        throw new StarlightError('BAD_REQUEST', 'content is required');
      }
      return sources.importFromJS(filename, content);
    }, 201));

  router.post(`${prefix}/toggle`, async (req) =>
    runApi(async () => {
      const body = parseJsonBody<SourceToggleBody>(req);
      const id = requireId(body.id);
      const enabled = boolField(body.enabled);
      await sources.setEnabled(id, enabled);
      reloadRuntimesInBackground(runtimes, runtimeLabel);
      return sources.listSources().find((source) => source.id === id) || { id, enabled };
    }));

  router.post(`${prefix}/batch-toggle`, async (req) =>
    runApi(async () => {
      const body = parseJsonBody<SourceBatchToggleBody>(req);
      const ids = sourceIds(body.ids);
      const enabled = boolField(body.enabled);
      for (const id of ids) {
        await sources.setEnabled(id, enabled);
      }
      reloadRuntimesInBackground(runtimes, runtimeLabel);
      return { ids, enabled };
    }));

  router.delete(`${prefix}/:id`, async (_req, params) =>
    runApi(async () => {
      const id = requireId(params.id);
      await sources.deleteSource(id);
      reloadRuntimesInBackground(runtimes, runtimeLabel);
      return { id };
    }));
}
