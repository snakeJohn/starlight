import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_VERSION, SYNC_CODE } from '../../src/lx_sync/constants';
import { aesEncrypt, encodeData } from '../../src/lx_sync/crypto_lx';
import { createMsg2call } from '../../src/lx_sync/message2call';
import {
  frameToText,
  handleLxSyncWebSocket,
  startListSyncSession,
  type InboundWebSocket,
  type WebSocketRequest,
} from '../../src/lx_sync/protocol_ws';
import type { LxClientKeyInfo, LxListData } from '../../src/lx_sync/types';

const emptyList: LxListData = {
  defaultList: [],
  loveList: [],
  userList: [],
};

function makeKeyInfo(overrides: Partial<LxClientKeyInfo> = {}): LxClientKeyInfo {
  return {
    clientId: 'cid-test',
    key: Buffer.from('0123456789abcdef').toString('base64'),
    deviceName: 'Desktop-UT',
    isMobile: false,
    lastConnectDate: Date.now(),
    ...overrides,
  };
}

class FakeSocket implements InboundWebSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private messageHandlers: Array<(data: string | ArrayBuffer | Uint8Array) => void> = [];
  private closeHandlers: Array<() => void> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = 3;
    for (const h of this.closeHandlers) h();
  }

  onMessage(handler: (data: string | ArrayBuffer | Uint8Array) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  emitMessage(data: string | ArrayBuffer | Uint8Array): void {
    for (const h of this.messageHandlers) h(data);
  }
}

function makeService(keyInfo: LxClientKeyInfo) {
  const peers = new Map<string, unknown>();
  return {
    async getServerMeta() {
      return { enabled: true, serverId: 'sid', serverName: 'Starlight' };
    },
    async getDevice(clientId: string) {
      return clientId === keyInfo.clientId ? keyInfo : null;
    },
    async touchDevice() {},
    async markSynced() {},
    async withSyncLock<T>(fn: () => Promise<T>) {
      return fn();
    },
    async getLocalListData() {
      return emptyList;
    },
    async setLocalListData() {},
    async applyListAction() {},
    async broadcastListAction() {},
    getDeviceListSnapshotKey: vi.fn(async () => undefined as string | undefined),
    setDeviceListSnapshotKey: vi.fn(async () => {}),
    ensureSongloftImportAfterSync: vi.fn(),
    registerListPeer(peer: { clientId: string }) {
      peers.set(peer.clientId, peer);
    },
    unregisterListPeer(clientId: string) {
      peers.delete(clientId);
    },
    _peers: peers,
  };
}

describe('frameToText', () => {
  it('accepts string frames', () => {
    expect(frameToText('hello')).toBe('hello');
  });

  it('decodes ArrayBuffer / Uint8Array frames', () => {
    const bytes = new TextEncoder().encode('{"name":"x"}');
    expect(frameToText(bytes.buffer)).toBe('{"name":"x"}');
    expect(frameToText(bytes)).toBe('{"name":"x"}');
  });

  it('unwraps { data } host event shape', () => {
    expect(frameToText({ data: 'ping' })).toBe('ping');
  });

  it('returns null for unsupported types', () => {
    expect(frameToText(null)).toBeNull();
    expect(frameToText(42)).toBeNull();
  });
});

describe('createMsg2call round-trip', () => {
  it('resolves remote calls when message replies arrive', async () => {
    const sent: Array<{ name: string; path?: string[]; data?: unknown }> = [];
    const m2c = createMsg2call({
      funcsObj: {},
      timeout: 2000,
      sendMessage(data) {
        sent.push(data as { name: string; path?: string[]; data?: unknown });
      },
    });

    const p = (m2c.remote as { getEnabledFeatures: (...a: unknown[]) => Promise<unknown> }).getEnabledFeatures(
      'server',
      FEATURE_VERSION,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toEqual(['getEnabledFeatures']);

    m2c.message({ name: sent[0].name, error: null, data: { list: { skipSnapshot: false } } });
    await expect(p).resolves.toEqual({ list: { skipSnapshot: false } });
  });
});

function makeSyncService(overrides: Record<string, unknown> = {}) {
  return {
    async withSyncLock<T>(fn: () => Promise<T>) {
      return fn();
    },
    async getLocalListData() {
      return emptyList;
    },
    async setLocalListData() {},
    getDeviceListSnapshotKey: vi.fn(async () => undefined as string | undefined),
    setDeviceListSnapshotKey: vi.fn(async () => {}),
    ensureSongloftImportAfterSync: vi.fn(),
    ...overrides,
  };
}

describe('startListSyncSession', () => {
  it('pulls remote list when local is empty and marks list ready', async () => {
    const remoteList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'l1', name: '曲', singer: 'S', source: 'wy', interval: '01:00', meta: {} }],
      userList: [],
    };
    let setLocal: LxListData | null = null;
    const service = makeSyncService({
      async setLocalListData(data: LxListData) {
        setLocal = data;
      },
    });
    const remote = {
      getEnabledFeatures: vi.fn(async () => ({ list: { skipSnapshot: false } })),
      finished: vi.fn(async () => {}),
      onListSyncAction: vi.fn(async () => {}),
    };
    const remoteQueueList = {
      list_sync_get_list_data: vi.fn(async () => remoteList),
      list_sync_get_sync_mode: vi.fn(async () => 'merge_local_remote'),
      list_sync_set_list_data: vi.fn(async () => {}),
      list_sync_finished: vi.fn(async () => {}),
    };
    const socketCtx = {
      feature: {
        list: false as false | { skipSnapshot?: boolean },
        dislike: false as false | { skipSnapshot?: boolean },
      },
      moduleReadys: { list: false, dislike: false },
    };

    await startListSyncSession(
      service as never,
      makeKeyInfo(),
      remote,
      remoteQueueList,
      socketCtx,
    );

    expect(remote.getEnabledFeatures).toHaveBeenCalledWith('server', FEATURE_VERSION);
    expect(setLocal).toEqual(remoteList);
    expect(remoteQueueList.list_sync_finished).toHaveBeenCalled();
    expect(socketCtx.moduleReadys.list).toBe(true);
    expect(service.ensureSongloftImportAfterSync).toHaveBeenCalled();
    expect(service.setDeviceListSnapshotKey).toHaveBeenCalled();
  });

  it('pushes local list when remote is empty', async () => {
    const localList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'a', name: 'A', singer: 'B', source: 'kw', interval: '02:00', meta: {} }],
      userList: [],
    };
    const service = makeSyncService({
      async getLocalListData() {
        return localList;
      },
    });
    const remote = {
      getEnabledFeatures: vi.fn(async () => ({ list: true })),
      finished: vi.fn(async () => {}),
      onListSyncAction: vi.fn(async () => {}),
    };
    const remoteQueueList = {
      list_sync_get_list_data: vi.fn(async () => emptyList),
      list_sync_get_sync_mode: vi.fn(async () => 'cancel'),
      list_sync_set_list_data: vi.fn(async () => {}),
      list_sync_finished: vi.fn(async () => {}),
    };
    const socketCtx = {
      feature: {
        list: false as false | { skipSnapshot?: boolean },
        dislike: false as false | { skipSnapshot?: boolean },
      },
      moduleReadys: { list: false, dislike: false },
    };

    await startListSyncSession(
      service as never,
      makeKeyInfo(),
      remote,
      remoteQueueList,
      socketCtx,
    );

    expect(remoteQueueList.list_sync_set_list_data).toHaveBeenCalledWith(localList);
    expect(socketCtx.moduleReadys.list).toBe(true);
    expect(remoteQueueList.list_sync_get_sync_mode).not.toHaveBeenCalled();
    expect(service.ensureSongloftImportAfterSync).toHaveBeenCalled();
  });

  it('skips mode dialog when local and remote lists are already equal', async () => {
    const shared: LxListData = {
      defaultList: [],
      loveList: [{ id: 'a', name: 'A', singer: 'B', source: 'kw', interval: '02:00', meta: {} }],
      userList: [],
    };
    const service = makeSyncService({
      async getLocalListData() {
        return shared;
      },
      setLocalListData: vi.fn(async () => {}),
    });
    const remote = {
      getEnabledFeatures: vi.fn(async () => ({ list: true })),
      finished: vi.fn(async () => {}),
      onListSyncAction: vi.fn(async () => {}),
    };
    const remoteQueueList = {
      list_sync_get_list_data: vi.fn(async () => shared),
      list_sync_get_sync_mode: vi.fn(async () => 'merge_local_remote'),
      list_sync_set_list_data: vi.fn(async () => {}),
      list_sync_finished: vi.fn(async () => {}),
    };
    const socketCtx = {
      feature: {
        list: false as false | { skipSnapshot?: boolean },
        dislike: false as false | { skipSnapshot?: boolean },
      },
      moduleReadys: { list: false, dislike: false },
    };

    await startListSyncSession(service as never, makeKeyInfo(), remote, remoteQueueList, socketCtx);

    expect(remoteQueueList.list_sync_get_sync_mode).not.toHaveBeenCalled();
    expect(service.setLocalListData).not.toHaveBeenCalled();
    expect(remoteQueueList.list_sync_set_list_data).not.toHaveBeenCalled();
    // Still re-import to Songloft (user may have deleted host playlists).
    expect(service.ensureSongloftImportAfterSync).toHaveBeenCalled();
    expect(service.setDeviceListSnapshotKey).toHaveBeenCalled();
  });

  it('auto-merges without mode dialog when device already has a snapshot key', async () => {
    const localList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'a', name: 'A', singer: 'B', source: 'kw', interval: '02:00', meta: {} }],
      userList: [],
    };
    const remoteList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'b', name: 'B', singer: 'C', source: 'wy', interval: '03:00', meta: {} }],
      userList: [],
    };
    const setLocal = vi.fn(async () => {});
    const service = makeSyncService({
      async getLocalListData() {
        return localList;
      },
      setLocalListData: setLocal,
      getDeviceListSnapshotKey: vi.fn(async () => 'prev-snapshot-key'),
    });
    const remote = {
      getEnabledFeatures: vi.fn(async () => ({ list: { skipSnapshot: false } })),
      finished: vi.fn(async () => {}),
      onListSyncAction: vi.fn(async () => {}),
    };
    const remoteQueueList = {
      list_sync_get_list_data: vi.fn(async () => remoteList),
      list_sync_get_sync_mode: vi.fn(async () => 'merge_local_remote'),
      list_sync_set_list_data: vi.fn(async () => {}),
      list_sync_finished: vi.fn(async () => {}),
    };
    const socketCtx = {
      feature: {
        list: false as false | { skipSnapshot?: boolean },
        dislike: false as false | { skipSnapshot?: boolean },
      },
      moduleReadys: { list: false, dislike: false },
    };

    await startListSyncSession(service as never, makeKeyInfo(), remote, remoteQueueList, socketCtx);

    expect(remoteQueueList.list_sync_get_sync_mode).not.toHaveBeenCalled();
    expect(setLocal).toHaveBeenCalled();
    expect(remoteQueueList.list_sync_set_list_data).toHaveBeenCalled();
    expect(service.ensureSongloftImportAfterSync).toHaveBeenCalled();
  });

  it('asks mode dialog only on first conflict when device has no snapshot', async () => {
    const localList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'a', name: 'A', singer: 'B', source: 'kw', interval: '02:00', meta: {} }],
      userList: [],
    };
    const remoteList: LxListData = {
      defaultList: [],
      loveList: [{ id: 'b', name: 'B', singer: 'C', source: 'wy', interval: '03:00', meta: {} }],
      userList: [],
    };
    const service = makeSyncService({
      async getLocalListData() {
        return localList;
      },
      setLocalListData: vi.fn(async () => {}),
      getDeviceListSnapshotKey: vi.fn(async () => undefined),
    });
    const remote = {
      getEnabledFeatures: vi.fn(async () => ({ list: true })),
      finished: vi.fn(async () => {}),
      onListSyncAction: vi.fn(async () => {}),
    };
    const remoteQueueList = {
      list_sync_get_list_data: vi.fn(async () => remoteList),
      list_sync_get_sync_mode: vi.fn(async () => 'merge_local_remote'),
      list_sync_set_list_data: vi.fn(async () => {}),
      list_sync_finished: vi.fn(async () => {}),
    };
    const socketCtx = {
      feature: {
        list: false as false | { skipSnapshot?: boolean },
        dislike: false as false | { skipSnapshot?: boolean },
      },
      moduleReadys: { list: false, dislike: false },
    };

    await startListSyncSession(service as never, makeKeyInfo(), remote, remoteQueueList, socketCtx);

    expect(remoteQueueList.list_sync_get_sync_mode).toHaveBeenCalled();
    expect(service.setLocalListData).toHaveBeenCalled();
  });
});

describe('handleLxSyncWebSocket (non-blocking)', () => {
  const keyInfo = makeKeyInfo();
  let logInfo: ReturnType<typeof vi.fn>;
  let logWarn: ReturnType<typeof vi.fn>;
  let logError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logInfo = vi.fn();
    logWarn = vi.fn();
    logError = vi.fn();
    (globalThis as { songloft?: unknown }).songloft = {
      log: { info: logInfo, warn: logWarn, error: logError },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns before list sync finishes so the host can deliver frames', async () => {
    const socket = new FakeSocket();
    const service = makeService(keyInfo);
    const token = aesEncrypt(SYNC_CODE.msgConnect, keyInfo.key);
    const req: WebSocketRequest = {
      path: '/socket',
      query: `i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(token)}`,
    };

    // Client never answers RPCs → sync stays pending; handler must still return.
    const started = Date.now();
    await handleLxSyncWebSocket(req, socket, service as never);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(socket.closed).toHaveLength(0);
    expect(service._peers.has(keyInfo.clientId)).toBe(true);

    // Server should have emitted getEnabledFeatures (fire-and-forget after return).
    await vi.waitFor(() => {
      expect(socket.sent.length).toBeGreaterThan(0);
    });
    const first = JSON.parse(socket.sent[0]) as { path?: string[] };
    expect(first.path).toEqual(['getEnabledFeatures']);
  });

  it('completes full handshake when client answers RPCs over the socket', async () => {
    const socket = new FakeSocket();
    let marked = false;
    const service = {
      ...makeService(keyInfo),
      async getLocalListData() {
        return emptyList;
      },
      async setLocalListData() {},
      async markSynced() {
        marked = true;
      },
    };
    const token = aesEncrypt(SYNC_CODE.msgConnect, keyInfo.key);
    const req: WebSocketRequest = {
      path: '/socket',
      query: `i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(token)}`,
    };

    await handleLxSyncWebSocket(req, socket, service as never);

    // Pump message2call replies as the desktop client would.
    const reply = async (predicate: (msg: { path?: string[] }) => boolean, data: unknown) => {
      await vi.waitFor(() => {
        const hit = socket.sent
          .map((s) => JSON.parse(s) as { name: string; path?: string[] })
          .find((m) => m.path && predicate(m));
        expect(hit).toBeTruthy();
      });
      const msg = socket.sent
        .map((s) => JSON.parse(s) as { name: string; path?: string[] })
        .find((m) => m.path && predicate(m))!;
      socket.emitMessage(JSON.stringify({ name: msg.name, error: null, data }));
    };

    await reply((m) => m.path?.[0] === 'getEnabledFeatures', { list: { skipSnapshot: false } });
    await reply((m) => m.path?.[0] === 'list_sync_get_list_data', emptyList);
    await reply((m) => m.path?.[0] === 'list_sync_finished', null);
    await reply((m) => m.path?.[0] === 'finished', null);

    await vi.waitFor(() => {
      expect(marked).toBe(true);
    });
    expect(socket.closed).toHaveLength(0);
  });

  it('accepts binary ArrayBuffer frames for RPC replies', async () => {
    const socket = new FakeSocket();
    let marked = false;
    const service = {
      ...makeService(keyInfo),
      async getLocalListData() {
        return emptyList;
      },
      async markSynced() {
        marked = true;
      },
    };
    const token = aesEncrypt(SYNC_CODE.msgConnect, keyInfo.key);
    await handleLxSyncWebSocket(
      {
        path: '/socket',
        query: `i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(token)}`,
      },
      socket,
      service as never,
    );

    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    const first = JSON.parse(socket.sent[0]) as { name: string; path?: string[] };
    expect(first.path?.[0]).toBe('getEnabledFeatures');

    const payload = JSON.stringify({
      name: first.name,
      error: null,
      data: { list: { skipSnapshot: false } },
    });
    socket.emitMessage(new TextEncoder().encode(payload).buffer);

    // Continue with string frames for remaining RPCs
    const nextReply = async (path0: string, data: unknown) => {
      await vi.waitFor(() => {
        const hit = socket.sent
          .map((s) => {
            try {
              return JSON.parse(s) as { name: string; path?: string[] };
            } catch {
              return null;
            }
          })
          .find((m) => m?.path?.[0] === path0);
        expect(hit).toBeTruthy();
      });
      const msg = socket.sent
        .map((s) => JSON.parse(s) as { name: string; path?: string[] })
        .find((m) => m.path?.[0] === path0)!;
      socket.emitMessage(JSON.stringify({ name: msg.name, error: null, data }));
    };

    await nextReply('list_sync_get_list_data', emptyList);
    await nextReply('list_sync_finished', null);
    await nextReply('finished', null);

    await vi.waitFor(() => expect(marked).toBe(true));
  });

  it('rejects bad token without hanging', async () => {
    const socket = new FakeSocket();
    const service = makeService(keyInfo);
    await handleLxSyncWebSocket(
      {
        path: '/socket',
        query: `i=${encodeURIComponent(keyInfo.clientId)}&t=badtoken`,
      },
      socket,
      service as never,
    );
    expect(socket.closed.length).toBeGreaterThan(0);
  });
});

describe('encodeData envelope', () => {
  it('passes short payloads through unchanged', async () => {
    const s = JSON.stringify({ name: 'x', data: 1 });
    await expect(encodeData(s)).resolves.toBe(s);
  });
});

describe('createMsg2call destroy', () => {
  it('rejects queued group waiters on destroy', async () => {
    const m2c = createMsg2call({
      funcsObj: {},
      timeout: 5000,
      sendMessage() {},
    });
    const remote = m2c.createQueueRemote('list') as {
      a: () => Promise<unknown>;
      b: () => Promise<unknown>;
    };
    // First call starts handling; second waits in queue.
    const first = remote.a();
    const second = remote.b();
    m2c.destroy();
    await expect(first).rejects.toThrow(/destroy/);
    await expect(second).rejects.toThrow(/destroy/);
  });
});
