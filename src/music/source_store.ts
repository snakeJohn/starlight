import type { MusicSourceMeta } from './types';

const SOURCE_INDEX_KEY = 'starlight:music:sources';
const SOURCE_SCRIPT_PREFIX = 'starlight:music:source_script:';

export interface SourceStoreOptions {
  indexKey?: string;
  scriptPrefix?: string;
}

function asSourceIndex(value: unknown): MusicSourceMeta[] {
  return Array.isArray(value) ? (value as MusicSourceMeta[]) : [];
}

export class SourceStore {
  private readonly indexKey: string;
  private readonly scriptPrefix: string;

  constructor(options: SourceStoreOptions = {}) {
    this.indexKey = options.indexKey || SOURCE_INDEX_KEY;
    this.scriptPrefix = options.scriptPrefix || SOURCE_SCRIPT_PREFIX;
  }

  async loadIndex(): Promise<MusicSourceMeta[]> {
    const raw = await songloft.storage.get(this.indexKey);

    if (raw === null || raw === undefined || raw === '') {
      return [];
    }

    if (Array.isArray(raw)) {
      return asSourceIndex(raw);
    }

    if (typeof raw !== 'string') {
      return [];
    }

    try {
      return asSourceIndex(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }

  async saveIndex(sources: MusicSourceMeta[]): Promise<void> {
    await songloft.storage.set(this.indexKey, JSON.stringify(sources));
  }

  async saveScript(id: string, script: string): Promise<void> {
    await songloft.storage.set(this.scriptKey(id), script);
  }

  async loadScript(id: string): Promise<string | null> {
    const raw = await songloft.storage.get(this.scriptKey(id));
    return typeof raw === 'string' ? raw : null;
  }

  async deleteScript(id: string): Promise<void> {
    await songloft.storage.delete(this.scriptKey(id));
  }

  private scriptKey(id: string): string {
    return `${this.scriptPrefix}${id}`;
  }
}
