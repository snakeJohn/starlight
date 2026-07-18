import type { CustomPlaylist } from './types';

const CUSTOM_PLAYLIST_INDEX_KEY = 'starlight:custom_playlists:index';

function asPlaylists(value: unknown): CustomPlaylist[] {
  return Array.isArray(value) ? (value as CustomPlaylist[]) : [];
}

/**
 * Single-key playlist index. All load/mutate/save paths share one async queue
 * so concurrent UI edits and LX snapshots cannot last-write-win each other.
 */
export class CustomPlaylistStore {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Run exclusive work against the playlist index (serializes concurrent writers).
   * Use for any load → mutate → save sequence.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.chain;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Snapshot read. Queued with writers so concurrent save cannot tear mid-read.
   * Prefer `mutate` for load→mutate→save sequences.
   */
  async loadAll(): Promise<CustomPlaylist[]> {
    return this.runExclusive(() => this.readAll());
  }

  /**
   * Full replace of the index. Prefer `mutate` when basing the write on a prior load.
   */
  async saveAll(playlists: CustomPlaylist[]): Promise<void> {
    await this.runExclusive(() => this.writeAll(playlists));
  }

  /**
   * Atomic load → mutate → save under one store lock.
   * Preferred over separate loadAll/saveAll for multi-step updates.
   */
  async mutate(
    mutator: (playlists: CustomPlaylist[]) => CustomPlaylist[] | Promise<CustomPlaylist[]>,
  ): Promise<CustomPlaylist[]> {
    return this.runExclusive(async () => {
      const current = await this.readAll();
      const next = await mutator(current);
      await this.writeAll(next);
      return next;
    });
  }

  private async readAll(): Promise<CustomPlaylist[]> {
    const raw = await songloft.storage.get(CUSTOM_PLAYLIST_INDEX_KEY);
    if (raw === null || raw === undefined || raw === '') {
      return [];
    }
    if (Array.isArray(raw)) {
      return asPlaylists(raw);
    }
    if (typeof raw !== 'string') {
      return [];
    }
    try {
      return asPlaylists(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }

  private async writeAll(playlists: CustomPlaylist[]): Promise<void> {
    await songloft.storage.set(CUSTOM_PLAYLIST_INDEX_KEY, JSON.stringify(playlists));
  }
}
