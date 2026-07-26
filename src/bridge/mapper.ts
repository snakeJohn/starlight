import type { SearchResultSong } from '../music/types';
import { remoteSongDedupKey } from '../utils/song_match';

export { remoteSongDedupKey };

export interface RemoteSongPayload {
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  duration: number;
  url: string;
  plugin_entry_path: string;
  source_data: string;
  dedup_key: string;
}

export interface RemoteSongOptions {
  pluginEntryPath?: string;
  includeSourceData?: boolean;
  sourceData?: unknown;
  dedupKey?: string;
}

export function toRemoteSong(song: SearchResultSong, url: string, options: RemoteSongOptions = {}): RemoteSongPayload {
  const pluginEntryPath = options.pluginEntryPath ?? '';
  const includeSourceData = options.includeSourceData ?? Boolean(pluginEntryPath);
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover_url: song.cover_url,
    duration: song.duration,
    url,
    plugin_entry_path: pluginEntryPath,
    source_data: includeSourceData ? JSON.stringify(options.sourceData ?? song.source_data) : '',
    dedup_key: options.dedupKey ?? (pluginEntryPath ? remoteSongDedupKey(song) : ''),
  };
}
