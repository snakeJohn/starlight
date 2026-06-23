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

function cloneMeta(meta: unknown): MusicSourceMeta {
  const source = asRecord(meta);

  return {
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
}

export class SourceManager {
  private sources: MusicSourceMeta[] = [];

  constructor(private readonly store: SourceStore) {}

  async init(): Promise<void> {
    this.sources = (await this.store.loadIndex()).map(cloneMeta);
  }

  listSources(): MusicSourceMeta[] {
    return this.sources.map(cloneMeta);
  }

  async importFromJS(filename: string, script: string): Promise<MusicSourceMeta> {
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

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const index = this.findSourceIndex(id);
    const nextSources = this.sources.map((source, sourceIndex) =>
      sourceIndex === index ? { ...cloneMeta(source), enabled } : cloneMeta(source),
    );

    await this.store.saveIndex(nextSources);
    this.sources = nextSources;
  }

  async deleteSource(id: string): Promise<void> {
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
  }

  async getScript(id: string): Promise<string | null> {
    return this.store.loadScript(id);
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
