import type { CustomPlaylist, CustomPlaylistSong } from '../custom_playlists/types';

/** Supported Songloft/LX online music platforms. */
export type LxMusicPlatform = 'kw' | 'kg' | 'tx' | 'mg' | 'wy';

export interface LxMusicInfoMeta {
  songId?: string | number;
  albumName?: string;
  picUrl?: string | null;
  hash?: string;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
  [key: string]: unknown;
}

export interface LxMusicInfo {
  id: string;
  name: string;
  singer: string;
  source: string;
  interval: string | null;
  meta: LxMusicInfoMeta;
}

export interface LxUserListInfo {
  id: string;
  name: string;
  source?: string;
  sourceListId?: string | number;
  locationUpdateTime?: number | null;
  list: LxMusicInfo[];
}

export interface LxListData {
  defaultList: LxMusicInfo[];
  loveList: LxMusicInfo[];
  userList: LxUserListInfo[];
}

export type LxSyncConflict = 'replace' | 'merge';

export interface LxSyncConfig {
  baseUrl: string;
  username: string;
  token?: string;
  lastSyncAt?: string;
  importDefaultList: boolean;
  conflict: LxSyncConflict;
}

export interface LxSyncConfigPublic {
  baseUrl: string;
  username: string;
  connected: boolean;
  lastSyncAt?: string;
  importDefaultList: boolean;
  conflict: LxSyncConflict;
}

export interface LxSyncConnectInput {
  baseUrl: string;
  username: string;
  password: string;
}

export interface LxSyncConfigPatch {
  baseUrl?: string;
  username?: string;
  importDefaultList?: boolean;
  conflict?: LxSyncConflict;
}

export interface LxPlaylistPreview {
  id: string;
  name: string;
  songCount: number;
  kind: 'love' | 'default' | 'user';
}

export interface LxSyncPreviewResult {
  playlists: LxPlaylistPreview[];
  totalSongs: number;
}

export interface LxSyncPullStats {
  playlistsCreated: number;
  playlistsUpdated: number;
  songsImported: number;
  playlists: Array<Pick<CustomPlaylist, 'id' | 'name' | 'songs'> & { songCount: number }>;
  lastSyncAt: string;
}

export interface LxMappedPlaylist {
  name: string;
  native_playlist_id: string;
  kind: 'love' | 'default' | 'user';
  cover_url: string;
  songs: CustomPlaylistSong[];
}

export const LX_SYNC_CONFIG_KEY = 'starlight:lx_sync:config';

export const LX_NATIVE_IDS = {
  love: 'lx:love',
  default: 'lx:default',
} as const;

export const DEFAULT_LX_SYNC_CONFIG: LxSyncConfig = {
  baseUrl: '',
  username: '',
  importDefaultList: true,
  conflict: 'replace',
};
