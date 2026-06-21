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

export function toRemoteSong(song: SearchResultSong, url: string): RemoteSongPayload {
  const info = song.source_data.songInfo;
  const id = info.musicId || info.songmid || info.hash || info.copyrightId || '';

  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover_url: song.cover_url,
    duration: song.duration,
    url,
    plugin_entry_path: '',
    source_data: JSON.stringify(song.source_data),
    dedup_key: id ? `${song.source_data.platform}:${id}` : '',
  };
}
