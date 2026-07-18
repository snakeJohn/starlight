import type { CustomPlaylist, CustomPlaylistSong } from '../custom_playlists/types';

/** Supported online music platforms in LX Music data. */
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

/**
 * LX Music desktop / mobile "我的列表" full snapshot shape
 * (`defaultList` + `loveList` + `userList`).
 */
export interface LxListData {
  defaultList: LxMusicInfo[];
  loveList: LxMusicInfo[];
  userList: LxUserListInfo[];
  tempList?: LxMusicInfo[];
}

export type LxSyncConflict = 'replace' | 'merge';

/** Local preferences only — no remote server credentials. */
export interface LxSyncConfig {
  importDefaultList: boolean;
  conflict: LxSyncConflict;
  lastImportAt?: string;
  lastExportAt?: string;
}

export interface LxSyncConfigPublic {
  importDefaultList: boolean;
  conflict: LxSyncConflict;
  lastImportAt?: string;
  lastExportAt?: string;
}

export interface LxSyncConfigPatch {
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

export interface LxSyncImportStats {
  playlistsCreated: number;
  playlistsUpdated: number;
  songsImported: number;
  playlists: Array<Pick<CustomPlaylist, 'id' | 'name'> & { songCount: number }>;
  lastImportAt: string;
}

/** @deprecated Use LxSyncImportStats */
export type LxSyncPullStats = LxSyncImportStats;

export interface LxMappedPlaylist {
  name: string;
  /** Stable LX-side identity stored as CustomPlaylist.sourceListId */
  lxListId: string;
  kind: 'love' | 'default' | 'user';
  cover_url: string;
  songs: CustomPlaylistSong[];
}

export const LX_SYNC_CONFIG_KEY = 'starlight:lx_sync:config';

export const LX_LIST_IDS = {
  love: 'lx:love',
  default: 'lx:default',
} as const;

/** @deprecated Use LX_LIST_IDS */
export const LX_NATIVE_IDS = LX_LIST_IDS;

export const DEFAULT_LX_SYNC_CONFIG: LxSyncConfig = {
  importDefaultList: true,
  conflict: 'replace',
};
