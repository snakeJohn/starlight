import { describe, expect, it } from 'vitest';
import {
  applyListActionToData,
  emptyListData,
  listDataEqual,
  listDataFingerprint,
  mergeListData,
  overwriteListData,
} from '../../src/lx_sync/list_merge';
import type { LxMusicInfo } from '../../src/lx_sync/types';

const song = (id: string, name = id): LxMusicInfo => ({
  id,
  name,
  singer: 's',
  source: 'kw',
  interval: '01:00',
  meta: { songId: id },
});

describe('list_merge actions', () => {
  it('list_music_add appends without duplicating ids', () => {
    const base = emptyListData();
    base.loveList = [song('a')];
    const next = applyListActionToData(base, {
      action: 'list_music_add',
      data: { id: 'love', musicInfos: [song('a'), song('b')], addMusicLocationType: 'bottom' },
    });
    expect(next.loveList.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('list_remove drops user lists', () => {
    const base = emptyListData();
    base.userList = [
      { id: 'u1', name: 'A', list: [song('1')] },
      { id: 'u2', name: 'B', list: [song('2')] },
    ];
    const next = applyListActionToData(base, { action: 'list_remove', data: ['u1'] });
    expect(next.userList.map((u) => u.id)).toEqual(['u2']);
  });

  it('list_data_overwrite replaces full snapshot', () => {
    const base = emptyListData();
    base.loveList = [song('old')];
    const next = applyListActionToData(base, {
      action: 'list_data_overwrite',
      data: { loveList: [song('new')], defaultList: [], userList: [] },
    });
    expect(next.loveList.map((s) => s.id)).toEqual(['new']);
  });

  it('listDataEqual / fingerprint detect content equality', () => {
    const a = emptyListData();
    a.loveList = [song('a')];
    const b = emptyListData();
    b.loveList = [song('a')];
    const c = emptyListData();
    c.loveList = [song('b')];
    expect(listDataEqual(a, b)).toBe(true);
    expect(listDataEqual(a, c)).toBe(false);
    expect(listDataFingerprint(a)).toBe(listDataFingerprint(b));
  });

  it('list_music_move uses official musicInfos payload', () => {
    const base = emptyListData();
    base.loveList = [song('a'), song('b')];
    base.defaultList = [song('c')];
    const next = applyListActionToData(base, {
      action: 'list_music_move',
      data: {
        fromId: 'love',
        toId: 'default',
        musicInfos: [song('b')],
        addMusicLocationType: 'bottom',
      },
    });
    expect(next.loveList.map((s) => s.id)).toEqual(['a']);
    // handleMergeMusic(bottom): source (moved) then target → b before c
    expect(next.defaultList.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('merge and overwrite helpers keep user lists as expected', () => {
    const a = emptyListData();
    a.loveList = [song('1')];
    a.userList = [{ id: 'u1', name: 'A', list: [song('x')] }];
    const b = emptyListData();
    b.loveList = [song('2')];
    b.userList = [{ id: 'u2', name: 'B', list: [song('y')] }];

    const merged = mergeListData(a, b);
    expect(merged.loveList.map((s) => s.id).sort()).toEqual(['1', '2']);
    expect(merged.userList.map((u) => u.id).sort()).toEqual(['u1', 'u2']);

    const over = overwriteListData(a, b);
    expect(over.loveList.map((s) => s.id)).toEqual(['1']);
    expect(over.userList.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
  });

  it('mergeListData unions songs for the same user list id (not just list meta)', () => {
    const local = emptyListData();
    local.userList = [{ id: 'u1', name: '古风', list: [song('a'), song('b')] }];
    const remote = emptyListData();
    // Same id, overlapping + disjoint tracks; both locationUpdateTime null → early-return path.
    remote.userList = [{ id: 'u1', name: '古风', list: [song('b'), song('c')] }];

    const merged = mergeListData(local, remote);
    expect(merged.userList).toHaveLength(1);
    expect(merged.userList[0].id).toBe('u1');
    expect(merged.userList[0].list.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('mergeListData dedupes identical song ids within a shared user list', () => {
    const local = emptyListData();
    local.userList = [{ id: 'u1', name: 'A', list: [song('x')] }];
    const remote = emptyListData();
    remote.userList = [{ id: 'u1', name: 'A', list: [song('x')] }];
    const merged = mergeListData(local, remote);
    expect(merged.userList[0].list.map((s) => s.id)).toEqual(['x']);
  });
});
