import type { MusicPlatform, SearchResultSong } from '../music/types';

export interface CustomPlaylistSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  source_name?: string;
  source_data?: SearchResultSong['source_data'];
  native_song_id?: string | number;
  stable_key: string;
}

export interface CustomPlaylist {
  id: string;
  name: string;
  cover_url: string;
  source?: MusicPlatform;
  source_name?: string;
  sourceListId?: string;
  native_playlist_id?: string | number;
  native_playlist_name?: string;
  imported_at: string;
  updated_at: string;
  songs: CustomPlaylistSong[];
}

export interface SongListDetail {
  name: string;
  cover_url?: string;
  cover?: string;
  img?: string;
  total?: number;
  songs: SearchResultSong[];
}

export interface ImportNetworkPlaylistInput {
  source: MusicPlatform;
  sourceListId: string;
  detail: SongListDetail;
}
