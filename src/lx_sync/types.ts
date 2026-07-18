import type { CustomPlaylistSong } from '../custom_playlists/types';

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

export type LxSyncMode =
  | 'merge_local_remote'
  | 'merge_remote_local'
  | 'overwrite_local_remote'
  | 'overwrite_remote_local'
  | 'overwrite_local_remote_full'
  | 'overwrite_remote_local_full'
  | 'cancel';

/** Auth device key (issued on first connect). */
export interface LxClientKeyInfo {
  clientId: string;
  key: string;
  deviceName: string;
  isMobile: boolean;
  lastConnectDate: number;
  serverName?: string;
  /**
   * Fingerprint of list data after a successful full sync with this device.
   * When set, subsequent reconnects auto-merge without the first-sync mode dialog
   * (same idea as lx-music-sync-server device snapshot keys).
   */
  listSnapshotKey?: string;
}

/** Local server preferences (protocol server mode). */
export interface LxSyncConfig {
  password: string;
  serverId: string;
  serverName: string;
  enabled: boolean;
  lastSyncAt?: string;
}

export interface LxSyncConfigPublic {
  /** Full URL LX clients should connect to (no trailing slash). */
  serverAddress: string;
  password: string;
  serverId: string;
  serverName: string;
  enabled: boolean;
  lastSyncAt?: string;
  devices: Array<Pick<LxClientKeyInfo, 'clientId' | 'deviceName' | 'isMobile' | 'lastConnectDate'>>;
  connectedCount: number;
}

export interface LxSyncConfigPatch {
  password?: string;
  serverName?: string;
  enabled?: boolean;
  /** When true, regenerate password. */
  regeneratePassword?: boolean;
}

export interface LxMappedPlaylist {
  name: string;
  /** Stable LX-side identity stored as CustomPlaylist.sourceListId */
  lxListId: string;
  kind: 'love' | 'default' | 'user';
  cover_url: string;
  songs: CustomPlaylistSong[];
}

export const LX_LIST_IDS = {
  love: 'lx:love',
  default: 'lx:default',
} as const;

export { LX_SYNC_CONFIG_KEY, LX_SYNC_DEVICES_KEY, DEFAULT_SERVER_NAME } from './constants';
