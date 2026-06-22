import type { CustomPlaylist } from './types';

const CUSTOM_PLAYLIST_INDEX_KEY = 'starlight:custom_playlists:index';

function asPlaylists(value: unknown): CustomPlaylist[] {
  return Array.isArray(value) ? (value as CustomPlaylist[]) : [];
}

export class CustomPlaylistStore {
  async loadAll(): Promise<CustomPlaylist[]> {
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

  async saveAll(playlists: CustomPlaylist[]): Promise<void> {
    await songloft.storage.set(CUSTOM_PLAYLIST_INDEX_KEY, JSON.stringify(playlists));
  }
}
