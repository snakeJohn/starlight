/** LX Music sync protocol constants (desktop + mobile compatible). */

export const SYNC_CODE = {
  helloMsg: 'Hello~::^-^::~v4~',
  idPrefix: 'OjppZDo6',
  authMsg: 'lx-music auth::',
  msgAuthFailed: 'Auth failed',
  msgBlockedIp: 'Blocked IP',
  msgConnect: 'lx-music connect',
  authFailed: 'Auth failed',
  missingAuthCode: 'Missing auth code',
} as const;

export const SYNC_CLOSE_CODE = {
  normal: 1000,
  failed: 4100,
} as const;

/** Client-reported mode → server interpretation (lxserver TRANS_MODE). */
export const TRANS_MODE: Record<string, string> = {
  merge_local_remote: 'merge_remote_local',
  merge_remote_local: 'merge_local_remote',
  overwrite_local_remote: 'overwrite_remote_local',
  overwrite_remote_local: 'overwrite_local_remote',
  overwrite_local_remote_full: 'overwrite_remote_local_full',
  overwrite_remote_local_full: 'overwrite_local_remote_full',
  cancel: 'cancel',
};

export const FEATURE_VERSION = {
  list: 1,
  dislike: 1,
} as const;

export const LX_SYNC_CONFIG_KEY = 'starlight:lx_sync:config';
export const LX_SYNC_DEVICES_KEY = 'starlight:lx_sync:devices';

export const DEFAULT_SERVER_NAME = 'Starlight';
