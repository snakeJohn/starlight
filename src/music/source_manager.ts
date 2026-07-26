import { StarlightError } from '../system/errors';
import type { MusicSourceMeta } from './types';
import { SourceStore } from './source_store';

interface SourceMetadataTags {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
}

export interface SourceImportFile {
  filename: string;
  content: string;
}

export interface SourceImportSkipped {
  filename: string;
  name: string;
  existingName: string;
  reason: 'duplicate';
}

export interface SourceImportFailed {
  filename: string;
  message: string;
}

export interface SourceImportManyResult {
  total: number;
  imported: MusicSourceMeta[];
  skipped: SourceImportSkipped[];
  failed: SourceImportFailed[];
}

const JSDOC_COMMENT_RE = /\/\*(?:!|\*)[\s\S]*?\*\//;

function parseSourceMetadata(script: string): SourceMetadataTags {
  const comment = script.match(JSDOC_COMMENT_RE)?.[0];
  if (!comment) {
    return {};
  }

  const tags: SourceMetadataTags = {};
  for (const rawLine of comment.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^\/\*(?:!|\*)?/, '')
      .replace(/\*\/$/, '')
      .replace(/^\*\s?/, '')
      .trim();
    const match = line.match(/^@([a-zA-Z]+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    const [, tag, value] = match;
    if (tag === 'name' || tag === 'version' || tag === 'description' || tag === 'author' || tag === 'homepage' || tag === 'repository') {
      tags[tag] = value.trim();
    }
  }

  return tags;
}

function filenameStem(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  return normalized.replace(/\.[^.]+$/, '').trim();
}

function readableId(value: string): string {
  const id = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id || 'source';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanField(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function platformList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((platform): platform is string => typeof platform === 'string') : [];
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function cloneMeta(meta: unknown): MusicSourceMeta {
  const source = asRecord(meta);
  const cloned: MusicSourceMeta = {
    id: stringField(source.id),
    name: stringField(source.name),
    version: stringField(source.version),
    description: stringField(source.description),
    author: stringField(source.author),
    homepage: stringField(source.homepage),
    filename: stringField(source.filename),
    importedAt: stringField(source.importedAt),
    enabled: booleanField(source.enabled),
    supportedPlatforms: platformList(source.supportedPlatforms),
  };

  const sourceUrl = optionalStringField(source.sourceUrl);
  const resolvedUrl = optionalStringField(source.resolvedUrl);
  const contentHash = optionalStringField(source.contentHash);
  const updatedAt = optionalStringField(source.updatedAt);
  if (sourceUrl !== undefined) cloned.sourceUrl = sourceUrl;
  if (resolvedUrl !== undefined) cloned.resolvedUrl = resolvedUrl;
  if (contentHash !== undefined) cloned.contentHash = contentHash;
  if (updatedAt !== undefined) cloned.updatedAt = updatedAt;

  return cloned;
}

export interface OnlineSourceUpsertInput {
  stableId: string;
  filename: string;
  script: string;
  sourceUrl: string;
  resolvedUrl: string;
  contentHash: string;
  enabled: boolean;
}

export interface OnlineSourceUpsertResult {
  operation: 'imported' | 'updated';
  source: MusicSourceMeta;
  contentChanged: boolean;
}

/** Per-URL online entry snapshot for dual-store import rollback (does not touch other sources). */
export type OnlineSourceEntrySnapshot =
  | { present: false }
  | { present: true; meta: MusicSourceMeta; script: string | null };

export interface SourceManagerSnapshot {
  sources: MusicSourceMeta[];
  scripts: Map<string, string | null>;
}

export class SourceManager {
  private sources: MusicSourceMeta[] = [];
  /** Serialize all index/script mutations (import, toggle, delete). */
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: SourceStore) {}

  async init(): Promise<void> {
    this.sources = (await this.store.loadIndex()).map(cloneMeta);
  }

  listSources(): MusicSourceMeta[] {
    return this.sources.map(cloneMeta);
  }

  /**
   * Run a full read-modify-write mutation exclusively.
   * Failures do not break the queue for subsequent mutations.
   */
  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(fn, fn);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async importFromJS(filename: string, script: string): Promise<MusicSourceMeta> {
    return this.enqueueMutation(() => this.importFromJSUnlocked(filename, script));
  }

  private async importFromJSUnlocked(filename: string, script: string): Promise<MusicSourceMeta> {
    if (script.trim() === '') {
      throw new StarlightError('SOURCE_IMPORT_INVALID', 'Music source script is empty', false, { filename });
    }

    const tags = parseSourceMetadata(script);
    const fallbackName = filenameStem(filename) || 'Imported Source';
    const name = tags.name || fallbackName;
    const id = this.uniqueId(readableId(name));
    const meta: MusicSourceMeta = {
      id,
      name,
      version: tags.version || '',
      description: tags.description || '',
      author: tags.author || '',
      homepage: tags.homepage || tags.repository || '',
      filename,
      importedAt: new Date().toISOString(),
      enabled: false,
      supportedPlatforms: [],
    };

    await this.store.saveScript(id, script);
    const nextSources = [...this.sources, meta];
    try {
      await this.store.saveIndex(nextSources);
    } catch (error) {
      await this.rollbackScript(id);
      throw error;
    }

    this.sources = nextSources.map(cloneMeta);

    return cloneMeta(meta);
  }

  async importManyFromJS(files: SourceImportFile[]): Promise<SourceImportManyResult> {
    return this.enqueueMutation(async () => {
      const result: SourceImportManyResult = {
        total: files.length,
        imported: [],
        skipped: [],
        failed: [],
      };
      const importedNames = new Set(this.sources.map((source) => source.name.trim()).filter(Boolean));

      for (const file of files) {
        const filename = file.filename;
        const content = file.content;
        const tags = parseSourceMetadata(content);
        const name = (tags.name || filenameStem(filename) || 'Imported Source').trim();

        if (importedNames.has(name)) {
          result.skipped.push({
            filename,
            name,
            existingName: name,
            reason: 'duplicate',
          });
          continue;
        }

        try {
          // Already inside the mutation queue — call unlocked path.
          const meta = await this.importFromJSUnlocked(filename, content);
          importedNames.add(meta.name.trim());
          result.imported.push(meta);
        } catch (error) {
          result.failed.push({
            filename,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return result;
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.enqueueMutation(async () => {
      const index = this.findSourceIndex(id);
      const nextSources = this.sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...cloneMeta(source), enabled } : cloneMeta(source),
      );

      await this.store.saveIndex(nextSources);
      this.sources = nextSources;
    });
  }

  async deleteSource(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const index = this.findSourceIndex(id);
      const previousSources = this.sources.map(cloneMeta);
      const nextSources = this.sources.filter((_, sourceIndex) => sourceIndex !== index).map(cloneMeta);

      await this.store.saveIndex(nextSources);
      try {
        await this.store.deleteScript(id);
      } catch (error) {
        await this.rollbackIndex(previousSources);
        throw error;
      }

      this.sources = nextSources;
    });
  }

  async getScript(id: string): Promise<string | null> {
    return this.store.loadScript(id);
  }

  /**
   * Upsert an online music source by exact normalized `sourceUrl`.
   * Same URL keeps the existing ID; different URLs stay independent even when names match.
   * Script body is rewritten only when `contentHash` changes.
   */
  async upsertOnlineSource(input: OnlineSourceUpsertInput): Promise<OnlineSourceUpsertResult> {
    return this.enqueueMutation(() => this.upsertOnlineSourceUnlocked(input));
  }

  private async upsertOnlineSourceUnlocked(input: OnlineSourceUpsertInput): Promise<OnlineSourceUpsertResult> {
    const sourceUrl = input.sourceUrl.trim();
    if (!sourceUrl) {
      throw new StarlightError('SOURCE_IMPORT_INVALID', 'Online source URL is required', false);
    }
    if (input.script.trim() === '') {
      throw new StarlightError('SOURCE_IMPORT_INVALID', 'Music source script is empty', false, {
        filename: input.filename,
      });
    }

    const existingIndex = this.sources.findIndex((source) => source.sourceUrl === sourceUrl);
    const now = new Date().toISOString();
    const tags = parseSourceMetadata(input.script);
    const fallbackName = filenameStem(input.filename) || 'Imported Source';
    const name = tags.name || fallbackName;

    if (existingIndex === -1) {
      const requestedId = input.stableId.trim() || readableId(name);
      // Online imports require a stable id; refuse to mint a suffix that would break re-import identity.
      if (input.stableId.trim() && this.sources.some((source) => source.id === requestedId)) {
        throw new StarlightError(
          'SOURCE_IMPORT_INVALID',
          'Online source id conflicts with an existing source',
          false,
          { id: requestedId, sourceUrl },
        );
      }
      const id = input.stableId.trim() ? requestedId : this.uniqueId(requestedId);
      const meta: MusicSourceMeta = {
        id,
        name,
        version: tags.version || '',
        description: tags.description || '',
        author: tags.author || '',
        homepage: tags.homepage || tags.repository || '',
        filename: input.filename,
        importedAt: now,
        enabled: input.enabled,
        supportedPlatforms: [],
        sourceUrl,
        resolvedUrl: input.resolvedUrl,
        contentHash: input.contentHash,
        updatedAt: now,
      };

      await this.store.saveScript(id, input.script);
      const nextSources = [...this.sources, meta];
      try {
        await this.store.saveIndex(nextSources);
      } catch (error) {
        await this.rollbackScript(id);
        throw error;
      }

      this.sources = nextSources.map(cloneMeta);
      return {
        operation: 'imported',
        source: cloneMeta(meta),
        contentChanged: true,
      };
    }

    const previous = cloneMeta(this.sources[existingIndex]);
    const contentChanged = previous.contentHash !== input.contentHash;
    const previousScript = contentChanged ? await this.store.loadScript(previous.id) : null;

    const updated: MusicSourceMeta = {
      ...previous,
      name,
      version: tags.version || previous.version || '',
      description: tags.description || previous.description || '',
      author: tags.author || previous.author || '',
      homepage: tags.homepage || tags.repository || previous.homepage || '',
      filename: input.filename,
      enabled: input.enabled,
      sourceUrl,
      resolvedUrl: input.resolvedUrl,
      contentHash: input.contentHash,
      updatedAt: now,
    };

    if (contentChanged) {
      await this.store.saveScript(previous.id, input.script);
    }

    const nextSources = this.sources.map((source, index) =>
      index === existingIndex ? updated : cloneMeta(source),
    );

    try {
      await this.store.saveIndex(nextSources);
    } catch (error) {
      if (contentChanged) {
        try {
          if (previousScript === null) {
            await this.store.deleteScript(previous.id);
          } else {
            await this.store.saveScript(previous.id, previousScript);
          }
        } catch {
          // Preserve the original index write failure; rollback is best effort.
        }
      }
      throw error;
    }

    this.sources = nextSources.map(cloneMeta);
    return {
      operation: 'updated',
      source: cloneMeta(updated),
      contentChanged,
    };
  }

  /** Capture index + script bodies (full store). Prefer captureOnlineEntryBySourceUrl for import rollback. */
  async captureSnapshot(): Promise<SourceManagerSnapshot> {
    const sources = this.sources.map(cloneMeta);
    const scripts = await this.store.loadScripts(sources.map((source) => source.id));
    return { sources, scripts: new Map(scripts) };
  }

  /** Restore a previous full-store snapshot (index, scripts, and in-memory state). */
  async restoreSnapshot(snapshot: SourceManagerSnapshot): Promise<void> {
    return this.enqueueMutation(async () => {
      const previousIds = new Set(this.sources.map((source) => source.id));
      const nextSources = snapshot.sources.map(cloneMeta);
      const nextIds = new Set(nextSources.map((source) => source.id));

      await this.store.saveIndex(nextSources);

      for (const [id, script] of snapshot.scripts) {
        if (script === null) {
          await this.store.deleteScript(id);
        } else {
          await this.store.saveScript(id, script);
        }
      }

      for (const id of previousIds) {
        if (!nextIds.has(id) && !snapshot.scripts.has(id)) {
          try {
            await this.store.deleteScript(id);
          } catch {
            // Best-effort cleanup of scripts that did not exist in the snapshot.
          }
        }
      }

      this.sources = nextSources;
    });
  }

  /**
   * Capture only the online entry for `sourceUrl` (if any).
   * Used so dual-store import rollback cannot wipe concurrent unrelated source edits.
   */
  async captureOnlineEntryBySourceUrl(sourceUrl: string): Promise<OnlineSourceEntrySnapshot> {
    return this.enqueueMutation(async () => {
      const normalized = sourceUrl.trim();
      const index = this.sources.findIndex((source) => source.sourceUrl === normalized);
      if (index === -1) {
        return { present: false };
      }
      const meta = cloneMeta(this.sources[index]);
      const script = await this.store.loadScript(meta.id);
      return { present: true, meta, script };
    });
  }

  /**
   * Restore a single online entry by sourceUrl / stableId without rewriting other sources.
   * - snapshot absent → delete any entry with this sourceUrl or the import stableId
   * - snapshot present → put back that meta + script (and drop a conflicting same-URL row)
   */
  async restoreOnlineEntry(
    sourceUrl: string,
    stableId: string,
    snapshot: OnlineSourceEntrySnapshot,
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const normalizedUrl = sourceUrl.trim();
      const normalizedStableId = stableId.trim();

      if (!snapshot.present) {
        const removeIds = new Set(
          this.sources
            .filter(
              (source) =>
                source.sourceUrl === normalizedUrl
                || (normalizedStableId !== '' && source.id === normalizedStableId),
            )
            .map((source) => source.id),
        );
        if (removeIds.size === 0) {
          return;
        }

        const nextSources = this.sources.filter((source) => !removeIds.has(source.id)).map(cloneMeta);
        await this.store.saveIndex(nextSources);
        for (const id of removeIds) {
          try {
            await this.store.deleteScript(id);
          } catch {
            // best effort
          }
        }
        this.sources = nextSources;
        return;
      }

      const restored = cloneMeta(snapshot.meta);
      // Drop any other row that shares the online URL or stole the stable id.
      const nextSources = this.sources
        .filter(
          (source) =>
            source.id !== restored.id
            && source.sourceUrl !== normalizedUrl
            && !(normalizedStableId && source.id === normalizedStableId && source.id !== restored.id),
        )
        .map(cloneMeta);
      nextSources.push(restored);

      await this.store.saveIndex(nextSources);
      if (snapshot.script === null) {
        try {
          await this.store.deleteScript(restored.id);
        } catch {
          // best effort
        }
      } else {
        await this.store.saveScript(restored.id, snapshot.script);
      }

      // Clean scripts for rows we dropped that are no longer referenced.
      const nextIds = new Set(nextSources.map((source) => source.id));
      for (const source of this.sources) {
        if (!nextIds.has(source.id) && source.id !== restored.id) {
          try {
            await this.store.deleteScript(source.id);
          } catch {
            // best effort
          }
        }
      }

      this.sources = nextSources.map(cloneMeta);
    });
  }

  private findSourceIndex(id: string): number {
    const index = this.sources.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      throw this.sourceMissingError(id);
    }

    return index;
  }

  private uniqueId(baseId: string): string {
    const usedIds = new Set(this.sources.map((source) => source.id));
    if (!usedIds.has(baseId)) {
      return baseId;
    }

    let suffix = 2;
    let candidate = `${baseId}-${suffix}`;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${baseId}-${suffix}`;
    }

    return candidate;
  }

  private sourceMissingError(id: string): StarlightError {
    return new StarlightError('SOURCE_NOT_ENABLED', `Music source is not enabled or does not exist: ${id}`, false, { id });
  }

  private async rollbackScript(id: string): Promise<void> {
    try {
      await this.store.deleteScript(id);
    } catch {
      // Preserve the original import failure; rollback is best effort.
    }
  }

  private async rollbackIndex(sources: MusicSourceMeta[]): Promise<void> {
    try {
      await this.store.saveIndex(sources);
    } catch {
      // Preserve the original delete failure; rollback is best effort.
    }
  }
}
