/**
 * LX Music WebSocket sync server (list module).
 * Path: /socket?i={clientId}&t={aes(msgConnect)}
 */

import { parseQuery } from '@songloft/plugin-sdk';
import { FEATURE_VERSION, SYNC_CLOSE_CODE, SYNC_CODE, TRANS_MODE } from './constants';
import { aesDecrypt, bytesToUtf8, decodeData, encodeData } from './crypto_lx';
import { createMsg2call } from './message2call';
import {
  listDataEqual,
  listDataFingerprint,
  listDataNonEmpty,
  mergeListData,
  overwriteListData,
  patchListData,
} from './list_merge';
import type { LxSyncService } from './service';
import type { LxClientKeyInfo, LxListData, LxSyncMode } from './types';

/** Local ambient types — host SDK may not export these on older versions. */
export interface WebSocketRequest {
  path: string;
  query: string;
  headers?: Record<string, string>;
}

export interface InboundWebSocket {
  readonly OPEN?: number;
  readyState?: number;
  send(data: string): Promise<void> | void;
  close(code?: number, reason?: string): Promise<void> | void;
  onMessage?(handler: (data: string | ArrayBuffer | Uint8Array) => void): void;
  onClose?(handler: () => void): void;
  onError?(handler: (err: unknown) => void): void;
  addEventListener?(type: string, handler: (event: { data?: unknown; code?: number }) => void): void;
}

/** Normalize host WS frames (string / ArrayBuffer / Uint8Array) to UTF-8 text. */
export function frameToText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) {
    return bytesToUtf8(new Uint8Array(raw));
  }
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return bytesToUtf8(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  // Some hosts wrap binary as { data: string | ArrayBuffer }
  if (typeof raw === 'object' && raw !== null && 'data' in (raw as object)) {
    return frameToText((raw as { data: unknown }).data);
  }
  return null;
}

export const WS_SOCKET_PATH = '/socket';

type RemoteList = {
  list_sync_get_list_data: () => Promise<Partial<LxListData>>;
  list_sync_get_sync_mode: () => Promise<string>;
  list_sync_set_list_data: (data: LxListData) => Promise<void>;
  list_sync_finished: () => Promise<void>;
};

type SocketCtx = {
  keyInfo: LxClientKeyInfo;
  moduleReadys: { list: boolean; dislike: boolean };
  feature: {
    list: false | { skipSnapshot?: boolean };
    dislike: false | { skipSnapshot?: boolean };
  };
  remote: {
    getEnabledFeatures: (
      serverType: string,
      supported: typeof FEATURE_VERSION,
    ) => Promise<Record<string, { skipSnapshot?: boolean } | boolean>>;
    finished: () => Promise<void>;
    onListSyncAction: (action: unknown) => Promise<unknown>;
  };
  remoteQueueList: RemoteList;
  onClose: (handler: (err: Error) => void) => () => void;
  close: (code?: number) => void;
};

export async function handleLxSyncWebSocket(
  req: WebSocketRequest,
  socket: InboundWebSocket,
  service: LxSyncService,
): Promise<void> {
  const path = String(req.path || '').split('?')[0];
  const isSocket =
    path === WS_SOCKET_PATH || path.endsWith('/socket') || path === '/socket';
  if (!isSocket) {
    await socket.close(1008, 'unknown path');
    return;
  }

  const query = parseQuery(req.query || '');
  const clientId = query.i || '';
  const token = query.t || '';
  if (!clientId || !token) {
    await socket.close(SYNC_CLOSE_CODE.failed, 'auth');
    return;
  }

  const meta = await service.getServerMeta();
  if (!meta.enabled) {
    await socket.close(SYNC_CLOSE_CODE.failed, 'disabled');
    return;
  }

  const keyInfo = await service.getDevice(clientId);
  if (!keyInfo) {
    await socket.close(SYNC_CLOSE_CODE.failed, 'unknown client');
    return;
  }

  let connectOk = false;
  try {
    connectOk = aesDecrypt(token, keyInfo.key) === SYNC_CODE.msgConnect;
  } catch {
    connectOk = false;
  }
  if (!connectOk) {
    await socket.close(SYNC_CLOSE_CODE.failed, 'bad token');
    return;
  }

  await service.touchDevice(clientId);

  let disconnected = false;
  const closeHandlers: Array<(err: Error) => void> = [];
  /** Serialize outbound encode+send so large gzip frames cannot reorder. */
  let outboundChain: Promise<void> = Promise.resolve();

  // Forward-declared so onListSyncAction can gate on readiness.
  const socketCtx: SocketCtx = {
    keyInfo,
    moduleReadys: { list: false, dislike: false },
    feature: {
      list: false as false | { skipSnapshot?: boolean },
      dislike: false as false | { skipSnapshot?: boolean },
    },
    remote: null as unknown as SocketCtx['remote'],
    remoteQueueList: null as unknown as RemoteList,
    onClose(handler: (err: Error) => void) {
      closeHandlers.push(handler);
      return () => {
        const idx = closeHandlers.indexOf(handler);
        if (idx >= 0) closeHandlers.splice(idx, 1);
      };
    },
    close(code?: number) {
      void socket.close(code ?? SYNC_CLOSE_CODE.failed);
    },
  };

  const msg2call = createMsg2call({
    funcsObj: {
      // Client → server incremental list actions after initial sync.
      async onListSyncAction(_socket: unknown, action: unknown) {
        // Match lxserver: ignore actions until initial list sync finished.
        if (!socketCtx.moduleReadys.list) {
          songloft.log.info('[LxSync] onListSyncAction ignored (list module not ready)');
          return;
        }
        try {
          await service.withSyncLock(async () => {
            await service.applyListAction(action);
          });
          // Fan-out to other ready clients (multi-device live list sync).
          await service.broadcastListAction(clientId, action);
          songloft.log.info(
            '[LxSync] onListSyncAction applied ' +
              String((action as { action?: string })?.action || '').slice(0, 40),
          );
        } catch (err) {
          songloft.log.warn('[LxSync] onListSyncAction failed: ' + String(err));
          // Propagate so the client RPC fails closed (matches lxserver).
          throw err;
        }
      },
    },
    timeout: 120_000,
    sendMessage(data) {
      if (disconnected) throw new Error('disconnected');
      outboundChain = outboundChain
        .then(async () => {
          if (disconnected) return;
          const payload = await encodeData(JSON.stringify(data));
          if (disconnected) return;
          try {
            await Promise.resolve(socket.send(payload));
          } catch (err) {
            songloft.log.warn('[LxSync] ws send failed: ' + String(err));
          }
        })
        .catch((err) => {
          songloft.log.error('[LxSync] encode/send message failed: ' + String(err));
          if (!disconnected) void socket.close(SYNC_CLOSE_CODE.failed);
        });
    },
    onCallBeforeParams(rawArgs) {
      return [socketCtx, ...rawArgs];
    },
    onError(error, pathParts, groupName) {
      songloft.log.error(
        `[LxSync] rpc error ${groupName || ''} ${pathParts.join('.')} ${error.message}`,
      );
    },
  });

  const remote = msg2call.remote as SocketCtx['remote'];
  const remoteQueueList = msg2call.createQueueRemote('list') as unknown as RemoteList;
  socketCtx.remote = remote;
  socketCtx.remoteQueueList = remoteQueueList;

  service.registerListPeer({
    clientId,
    isListReady: () => socketCtx.moduleReadys.list && !disconnected,
    notifyListAction: async (action: unknown) => {
      if (disconnected || !socketCtx.moduleReadys.list) return;
      await remote.onListSyncAction(action);
    },
    close: () => {
      void socket.close(SYNC_CLOSE_CODE.failed, 'revoked');
    },
  });

  /** Bound concurrent decode+dispatch work per socket (abuse / flood control). */
  let inFlightMessages = 0;
  const MAX_IN_FLIGHT = 4;

  const onMessage = (raw: unknown) => {
    if (disconnected) return;
    // Host heartbeats / keepalive
    if (raw === 'ping' || raw === 'pong') return;
    const text = frameToText(raw);
    if (text == null || text === '') return;
    if (text === 'ping' || text === 'pong') return;
    // Reject obviously oversized frames before async decode allocates more work.
    if (typeof text === 'string' && text.length > 3 * 1024 * 1024) {
      songloft.log.warn('[LxSync] frame rejected: too large');
      void socket.close(SYNC_CLOSE_CODE.failed);
      return;
    }
    if (inFlightMessages >= MAX_IN_FLIGHT) {
      songloft.log.warn('[LxSync] frame rejected: in-flight limit');
      void socket.close(SYNC_CLOSE_CODE.failed);
      return;
    }
    inFlightMessages += 1;
    void decodeData(text)
      .then((decoded) => {
        if (disconnected) return;
        let syncData: unknown;
        try {
          syncData = JSON.parse(decoded);
        } catch {
          songloft.log.error('[LxSync] parse message failed');
          void socket.close(SYNC_CLOSE_CODE.failed);
          return;
        }
        msg2call.message(syncData as { name: string });
      })
      .catch((err) => {
        songloft.log.error('[LxSync] decrypt/decode failed: ' + String(err));
        void socket.close(SYNC_CLOSE_CODE.failed);
      })
      .finally(() => {
        inFlightMessages = Math.max(0, inFlightMessages - 1);
      });
  };

  const onClose = () => {
    if (disconnected) return;
    disconnected = true;
    service.unregisterListPeer(clientId);
    const err = new Error('closed');
    for (const h of closeHandlers) {
      try {
        h(err);
      } catch {
        /* ignore */
      }
    }
    msg2call.destroy();
  };

  attachSocket(socket, onMessage, onClose);

  // Critical: do NOT await sync here.
  // Songloft host may not pump WS frames until onWebSocket returns.
  // Match lxserver: void handleConnection(...) so RPC replies can arrive.
  void startListSyncSession(service, keyInfo, remote, remoteQueueList, socketCtx, () => disconnected)
    .then(async () => {
      if (disconnected) return;
      await remote.finished();
      if (disconnected) return;
      await service.markSynced();
      songloft.log.info(`[LxSync] sync finished device=${keyInfo.deviceName}`);
    })
    .catch((err) => {
      songloft.log.warn('[LxSync] sync failed: ' + String(err));
      if (!disconnected) void socket.close(SYNC_CLOSE_CODE.failed);
    });
}

/**
 * Run list module sync under the service lock.
 * Extracted so tests can exercise the flow without a live socket.
 */
export async function startListSyncSession(
  service: LxSyncService,
  keyInfo: LxClientKeyInfo,
  remote: SocketCtx['remote'],
  remoteQueueList: RemoteList,
  socketCtx: Pick<SocketCtx, 'feature' | 'moduleReadys'>,
  isDisconnected: () => boolean = () => false,
): Promise<void> {
  await service.withSyncLock(async () => {
    if (isDisconnected()) throw new Error('disconnected');
    await runListSync(service, keyInfo, remote, remoteQueueList, socketCtx);
    if (isDisconnected()) throw new Error('disconnected');
  });
}

function attachSocket(
  socket: InboundWebSocket,
  onMessage: (data: unknown) => void,
  onClose: () => void,
): void {
  if (typeof socket.onMessage === 'function') {
    socket.onMessage((data) => onMessage(data));
  } else if (typeof socket.addEventListener === 'function') {
    socket.addEventListener('message', (event) => onMessage(event.data));
  }
  if (typeof socket.onClose === 'function') {
    socket.onClose(() => onClose());
  } else if (typeof socket.addEventListener === 'function') {
    socket.addEventListener('close', () => onClose());
  }
}

async function runListSync(
  service: LxSyncService,
  keyInfo: LxClientKeyInfo,
  remote: {
    getEnabledFeatures: (
      serverType: string,
      supported: typeof FEATURE_VERSION,
    ) => Promise<Record<string, { skipSnapshot?: boolean } | boolean>>;
    finished: () => Promise<void>;
  },
  remoteQueueList: RemoteList,
  socketCtx: {
    feature: {
      list: false | { skipSnapshot?: boolean };
      dislike: false | { skipSnapshot?: boolean };
    };
    moduleReadys: { list: boolean };
  },
): Promise<void> {
  const enabled = await remote.getEnabledFeatures('server', FEATURE_VERSION);
  if (!enabled?.list) {
    songloft.log.info('[LxSync] client has no list feature');
    return;
  }
  socketCtx.feature.list = typeof enabled.list === 'object' ? enabled.list : { skipSnapshot: false };
  const skipSnapshot =
    typeof socketCtx.feature.list === 'object' && Boolean(socketCtx.feature.list.skipSnapshot);

  const localListData = patchListData(await service.getLocalListData());
  const remoteListData = patchListData(await remoteQueueList.list_sync_get_list_data());

  songloft.log.info(
    `[LxSync] list sync local=${localListData.loveList.length}/${localListData.userList.length} remote=${remoteListData.loveList.length}/${remoteListData.userList.length} device=${keyInfo.deviceName}`,
  );

  let effectiveListData: LxListData = localListData;

  if (listDataNonEmpty(localListData)) {
    if (listDataNonEmpty(remoteListData)) {
      // Official lxserver only prompts mode on *first* sync. Later reconnects use
      // the device snapshot and auto-merge — no dialog. Mirror that here.
      const deviceSnapshotKey = skipSnapshot
        ? undefined
        : await service.getDeviceListSnapshotKey(keyInfo.clientId);

      if (listDataEqual(localListData, remoteListData)) {
        // Already in sync — skip mode dialog and list rewrites.
        songloft.log.info(`[LxSync] lists already equal device=${keyInfo.deviceName}; skip mode dialog`);
        effectiveListData = localListData;
      } else if (deviceSnapshotKey) {
        // Subsequent sync: auto-merge both sides (no popup).
        songloft.log.info(
          `[LxSync] auto-merge (device snapshot) device=${keyInfo.deviceName} key=${deviceSnapshotKey.slice(0, 12)}…`,
        );
        const merged = mergeListData(localListData, remoteListData);
        await service.setLocalListData(merged);
        await remoteQueueList.list_sync_set_list_data(merged);
        effectiveListData = merged;
      } else {
        // First conflict: ask LX client which mode to use (shows dialog once).
        const mode = await resolveMode(remoteQueueList);
        if (mode === 'cancel') throw new Error('cancel');
        let merged: LxListData;
        let updateLocal = true;
        let updateRemote = true;
        switch (mode) {
          case 'merge_local_remote':
            merged = mergeListData(localListData, remoteListData);
            break;
          case 'merge_remote_local':
            merged = mergeListData(remoteListData, localListData);
            break;
          case 'overwrite_local_remote':
            merged = overwriteListData(localListData, remoteListData);
            break;
          case 'overwrite_remote_local':
            merged = overwriteListData(remoteListData, localListData);
            break;
          case 'overwrite_local_remote_full':
            merged = localListData;
            updateLocal = false;
            break;
          case 'overwrite_remote_local_full':
            merged = remoteListData;
            updateRemote = false;
            break;
          default:
            throw new Error('cancel');
        }
        if (updateLocal) await service.setLocalListData(merged);
        if (updateRemote) await remoteQueueList.list_sync_set_list_data(merged);
        effectiveListData = merged;
      }
    } else {
      await remoteQueueList.list_sync_set_list_data(localListData);
      effectiveListData = localListData;
    }
  } else if (listDataNonEmpty(remoteListData)) {
    await service.setLocalListData(remoteListData);
    effectiveListData = remoteListData;
  }

  await remoteQueueList.list_sync_finished();
  socketCtx.moduleReadys.list = true;

  // Remember successful sync for this device so reconnect won't re-prompt.
  if (!skipSnapshot && listDataNonEmpty(effectiveListData)) {
    await service.setDeviceListSnapshotKey(keyInfo.clientId, listDataFingerprint(effectiveListData));
  }

  // Always push LX lists into Songloft after a successful session — even when list
  // data was already equal (user may have deleted Songloft playlists meanwhile).
  if (typeof service.ensureSongloftImportAfterSync === 'function') {
    service.ensureSongloftImportAfterSync();
  }
}

async function resolveMode(remoteQueueList: RemoteList): Promise<LxSyncMode | 'cancel'> {
  const clientMode = await remoteQueueList.list_sync_get_sync_mode();
  const mapped = TRANS_MODE[clientMode] || clientMode;
  return mapped as LxSyncMode | 'cancel';
}
