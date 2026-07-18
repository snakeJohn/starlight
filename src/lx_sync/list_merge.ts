import type { LxListData, LxMusicInfo, LxUserListInfo } from './types';

export type AddMusicLocationType = 'top' | 'bottom';

export function emptyListData(): LxListData {
  return { defaultList: [], loveList: [], userList: [] };
}

export function patchListData(listData: Partial<LxListData> | null | undefined): LxListData {
  return {
    defaultList: Array.isArray(listData?.defaultList) ? listData!.defaultList! : [],
    loveList: Array.isArray(listData?.loveList) ? listData!.loveList! : [],
    userList: Array.isArray(listData?.userList) ? listData!.userList! : [],
  };
}

export function listDataNonEmpty(data: LxListData): boolean {
  return data.defaultList.length > 0 || data.loveList.length > 0 || data.userList.length > 0;
}

/** Stable fingerprint of list content for skip-mode / device snapshot checks. */
export function listDataFingerprint(data: LxListData): string {
  const musicKey = (m: LxMusicInfo) => `${m.id}|${m.source}|${m.name}|${m.singer}`;
  const userKey = (u: LxUserListInfo) =>
    `${u.id}|${u.name}|${(u.list || []).map(musicKey).join(',')}`;
  return [
    (data.defaultList || []).map(musicKey).join(','),
    (data.loveList || []).map(musicKey).join(','),
    (data.userList || []).map(userKey).join(';'),
  ].join('#');
}

export function listDataEqual(a: LxListData, b: LxListData): boolean {
  return listDataFingerprint(a) === listDataFingerprint(b);
}

function handleMergeMusic(
  sourceList: LxMusicInfo[],
  targetList: LxMusicInfo[],
  addMusicLocationType: AddMusicLocationType,
): LxMusicInfo[] {
  const map = new Map<string | number, LxMusicInfo>();
  const ids: Array<string | number> = [];
  const combined =
    addMusicLocationType === 'top' ? [...targetList, ...sourceList] : [...sourceList, ...targetList];
  if (addMusicLocationType === 'top') {
    for (let i = combined.length - 1; i > -1; i--) {
      const item = combined[i];
      if (map.has(item.id)) continue;
      ids.unshift(item.id);
      map.set(item.id, item);
    }
  } else {
    for (const item of combined) {
      if (map.has(item.id)) continue;
      ids.push(item.id);
      map.set(item.id, item);
    }
  }
  return ids.map((id) => map.get(id)!) as LxMusicInfo[];
}

function userMap(listData: LxListData): Map<string, LxUserListInfo> {
  const m = new Map<string, LxUserListInfo>();
  for (const list of listData.userList) m.set(list.id, list);
  return m;
}

/**
 * Merge source into target (source list meta wins; songs unioned).
 * User-list copies live in `newListData.userList`; the map points at those same
 * objects so song merges and position reorders apply to the returned snapshot.
 */
export function mergeListData(
  sourceListData: LxListData,
  targetListData: LxListData,
  addMusicLocationType: AddMusicLocationType = 'bottom',
): LxListData {
  const newListData: LxListData = emptyListData();
  newListData.defaultList = handleMergeMusic(
    sourceListData.defaultList,
    targetListData.defaultList,
    addMusicLocationType,
  );
  newListData.loveList = handleMergeMusic(
    sourceListData.loveList,
    targetListData.loveList,
    addMusicLocationType,
  );

  // Deep-copy user lists first, then index those copies (not the originals).
  newListData.userList = sourceListData.userList.map((l) => ({ ...l, list: [...l.list] }));
  const userListDataObj = userMap({ ...emptyListData(), userList: newListData.userList });

  targetListData.userList.forEach((list, index) => {
    const targetUpdateTime = list?.locationUpdateTime ?? 0;
    const sourceList = userListDataObj.get(list.id);
    if (sourceList) {
      // Always merge songs onto the returned copy; early return only skips reorder.
      sourceList.list = handleMergeMusic(sourceList.list, list.list, addMusicLocationType);
      const sourceUpdateTime = sourceList.locationUpdateTime ?? 0;
      if (targetUpdateTime >= sourceUpdateTime) return;
      const idx = newListData.userList.findIndex((l) => l.id == list.id);
      if (idx >= 0) {
        const [moved] = newListData.userList.splice(idx, 1);
        moved.locationUpdateTime = targetUpdateTime;
        newListData.userList.splice(index, 0, moved);
      }
    } else if (targetUpdateTime) {
      newListData.userList.splice(index, 0, { ...list, list: [...list.list] });
    } else {
      newListData.userList.push({ ...list, list: [...list.list] });
    }
  });

  return newListData;
}

/** Overwrite: take source fixed lists; keep target-only user lists. */
export function overwriteListData(sourceListData: LxListData, targetListData: LxListData): LxListData {
  const newListData: LxListData = emptyListData();
  newListData.defaultList = [...sourceListData.defaultList];
  newListData.loveList = [...sourceListData.loveList];
  const userListDataObj = userMap(sourceListData);
  newListData.userList = sourceListData.userList.map((l) => ({ ...l, list: [...l.list] }));

  targetListData.userList.forEach((list, index) => {
    if (userListDataObj.has(list.id)) return;
    if (list?.locationUpdateTime) {
      newListData.userList.splice(index, 0, { ...list, list: [...list.list] });
    } else {
      newListData.userList.push({ ...list, list: [...list.list] });
    }
  });
  return newListData;
}

function cloneListData(data: LxListData): LxListData {
  return {
    defaultList: [...data.defaultList],
    loveList: [...data.loveList],
    userList: data.userList.map((l) => ({ ...l, list: [...l.list] })),
  };
}

function asMusicInfos(value: unknown): LxMusicInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object') as LxMusicInfo[];
}

function getListMusics(data: LxListData, listId: string): LxMusicInfo[] | null {
  if (listId === 'default') return data.defaultList;
  if (listId === 'love') return data.loveList;
  const user = data.userList.find((l) => l.id === listId);
  return user ? user.list : null;
}

function setListMusics(data: LxListData, listId: string, musics: LxMusicInfo[]): void {
  if (listId === 'default') {
    data.defaultList = musics;
    return;
  }
  if (listId === 'love') {
    data.loveList = musics;
    return;
  }
  const user = data.userList.find((l) => l.id === listId);
  if (user) user.list = musics;
}

/**
 * Apply an LX client list-sync action to ListData (local server store).
 * Unknown actions leave data unchanged.
 */
export function applyListActionToData(listData: LxListData, action: unknown): LxListData {
  if (!action || typeof action !== 'object') return listData;
  const row = action as { action?: string; data?: unknown };
  const type = String(row.action || '');
  const payload = row.data;
  const next = cloneListData(listData);

  switch (type) {
    case 'list_data_overwrite': {
      if (payload && typeof payload === 'object') {
        return patchListData(payload as Partial<LxListData>);
      }
      return next;
    }
    case 'list_create': {
      const data = payload as { position?: number; listInfos?: LxUserListInfo[] } | undefined;
      const infos = Array.isArray(data?.listInfos) ? data!.listInfos! : [];
      const position = typeof data?.position === 'number' ? data.position : next.userList.length;
      for (const info of infos) {
        if (!info || typeof info !== 'object') continue;
        const id = String(info.id || '');
        if (!id || next.userList.some((l) => l.id === id)) continue;
        next.userList.splice(Math.max(0, Math.min(position, next.userList.length)), 0, {
          id,
          name: String(info.name || id),
          source: info.source,
          sourceListId: info.sourceListId,
          locationUpdateTime: info.locationUpdateTime ?? null,
          list: asMusicInfos(info.list),
        });
      }
      return next;
    }
    case 'list_remove': {
      const ids = new Set((Array.isArray(payload) ? payload : []).map(String));
      next.userList = next.userList.filter((l) => !ids.has(l.id));
      return next;
    }
    case 'list_update': {
      const infos = Array.isArray(payload) ? (payload as LxUserListInfo[]) : [];
      for (const info of infos) {
        if (!info || typeof info !== 'object') continue;
        const target = next.userList.find((l) => l.id === String(info.id));
        if (!target) continue;
        if (info.name !== undefined) target.name = String(info.name);
        if (info.source !== undefined) target.source = info.source;
        if (info.sourceListId !== undefined) target.sourceListId = info.sourceListId;
        if (info.locationUpdateTime !== undefined) target.locationUpdateTime = info.locationUpdateTime;
      }
      return next;
    }
    case 'list_update_position': {
      const data = payload as { ids?: string[]; position?: number } | undefined;
      const ids = Array.isArray(data?.ids) ? data!.ids!.map(String) : [];
      const position = typeof data?.position === 'number' ? data.position : 0;
      const moving = next.userList.filter((l) => ids.includes(l.id));
      const rest = next.userList.filter((l) => !ids.includes(l.id));
      const insertAt = Math.max(0, Math.min(position, rest.length));
      next.userList = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
      return next;
    }
    case 'list_music_overwrite': {
      const data = payload as { listId?: string; musicInfos?: LxMusicInfo[] } | undefined;
      const listId = String(data?.listId || '');
      if (listId && getListMusics(next, listId)) {
        setListMusics(next, listId, asMusicInfos(data?.musicInfos));
      }
      return next;
    }
    case 'list_music_add': {
      const data = payload as {
        id?: string;
        musicInfos?: LxMusicInfo[];
        addMusicLocationType?: AddMusicLocationType;
      } | undefined;
      const listId = String(data?.id || '');
      const existing = getListMusics(next, listId);
      if (!existing) return next;
      const addType = data?.addMusicLocationType === 'top' ? 'top' : 'bottom';
      setListMusics(next, listId, handleMergeMusic(asMusicInfos(data?.musicInfos), existing, addType));
      return next;
    }
    case 'list_music_remove': {
      const data = payload as { listId?: string; ids?: Array<string | number> } | undefined;
      const listId = String(data?.listId || '');
      const existing = getListMusics(next, listId);
      if (!existing) return next;
      const ids = new Set((Array.isArray(data?.ids) ? data!.ids! : []).map(String));
      setListMusics(
        next,
        listId,
        existing.filter((m) => !ids.has(String(m.id))),
      );
      return next;
    }
    case 'list_music_clear': {
      const ids = Array.isArray(payload) ? payload.map(String) : [];
      for (const listId of ids) {
        if (getListMusics(next, listId)) setListMusics(next, listId, []);
      }
      return next;
    }
    case 'list_music_update': {
      const items = Array.isArray(payload)
        ? (payload as Array<{ id?: string; musicInfo?: LxMusicInfo }>)
        : [];
      for (const item of items) {
        const listId = String(item?.id || '');
        const music = item?.musicInfo;
        if (!listId || !music || typeof music !== 'object') continue;
        const existing = getListMusics(next, listId);
        if (!existing) continue;
        const idx = existing.findIndex((m) => String(m.id) === String(music.id));
        if (idx >= 0) existing[idx] = music;
      }
      return next;
    }
    case 'list_music_update_position': {
      const data = payload as {
        listId?: string;
        ids?: Array<string | number>;
        position?: number;
      } | undefined;
      const listId = String(data?.listId || '');
      const existing = getListMusics(next, listId);
      if (!existing) return next;
      const ids = (Array.isArray(data?.ids) ? data!.ids! : []).map(String);
      const position = typeof data?.position === 'number' ? data.position : 0;
      const moving = existing.filter((m) => ids.includes(String(m.id)));
      const rest = existing.filter((m) => !ids.includes(String(m.id)));
      const insertAt = Math.max(0, Math.min(position, rest.length));
      setListMusics(next, listId, [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)]);
      return next;
    }
    case 'list_music_move': {
      // Official client: { fromId, toId, musicInfos, addMusicLocationType }
      const data = payload as {
        fromId?: string;
        toId?: string;
        musicInfos?: LxMusicInfo[];
        musicIds?: Array<string | number>;
        addMusicLocationType?: AddMusicLocationType;
      } | undefined;
      const fromId = String(data?.fromId || '');
      const toId = String(data?.toId || '');
      const fromList = getListMusics(next, fromId);
      const toList = getListMusics(next, toId);
      if (!fromList || !toList) return next;
      const infos = asMusicInfos(data?.musicInfos);
      const ids = new Set(
        infos.length
          ? infos.map((m) => String(m.id))
          : (Array.isArray(data?.musicIds) ? data!.musicIds! : []).map(String),
      );
      const moving = infos.length ? infos : fromList.filter((m) => ids.has(String(m.id)));
      setListMusics(
        next,
        fromId,
        fromList.filter((m) => !ids.has(String(m.id))),
      );
      const addType = data?.addMusicLocationType === 'top' ? 'top' : 'bottom';
      setListMusics(next, toId, handleMergeMusic(moving, toList, addType));
      return next;
    }
    default:
      return next;
  }
}
