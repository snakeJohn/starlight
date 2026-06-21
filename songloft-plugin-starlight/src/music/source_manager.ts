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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id || 'source';
}

function cloneMeta(meta: MusicSourceMeta): MusicSourceMeta {
  return {
    ...meta,
    supportedPlatforms: [...meta.supportedPlatforms],
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
    this.sources.push(meta);
    await this.store.saveIndex(this.sources);

    return cloneMeta(meta);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const source = this.findSource(id);
    source.enabled = enabled;
    await this.store.saveIndex(this.sources);
  }

  async deleteSource(id: string): Promise<void> {
    const index = this.sources.findIndex((source) => source.id === id);
    if (index === -1) {
      throw this.sourceMissingError(id);
    }

    this.sources.splice(index, 1);
    await this.store.deleteScript(id);
    await this.store.saveIndex(this.sources);
  }

  async getScript(id: string): Promise<string | null> {
    return this.store.loadScript(id);
  }

  private findSource(id: string): MusicSourceMeta {
    const source = this.sources.find((candidate) => candidate.id === id);
    if (!source) {
      throw this.sourceMissingError(id);
    }

    return source;
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
}
