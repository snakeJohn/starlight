import type { SearchResultSong } from '../music/types';

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

export function remoteSongDedupKey(song: SearchResultSong): string {
  const info = song.source_data.songInfo;
  const id = info.musicId
    || info.songmid
    || info.songId
    || info.rid
    || info.id
    || info.mid
    || info.hash
    || info.copyrightId
    || info.strMediaMid
    || '';
  return id ? `${song.source_data.platform}:${id}` : '';
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
