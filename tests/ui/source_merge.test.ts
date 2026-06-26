import { describe, expect, it } from 'vitest';

interface MusicModule {
  mergeSourceRows(
    playbackSources: Array<Record<string, unknown>>,
    downloadSources: Array<Record<string, unknown>>,
  ): Array<{
    key: string;
    title: string;
    playback: Record<string, unknown> | null;
    download: Record<string, unknown> | null;
  }>;
}

async function loadMusicModule(): Promise<MusicModule> {
  const modulePath = '../../static/js/music_modules/sources.js';
  return await import(modulePath) as MusicModule;
}

describe('merged source rows', () => {
  it('merges playback and download sources when they share the same stable id', async () => {
    const { mergeSourceRows } = await loadMusicModule();

    const rows = mergeSourceRows(
      [{ id: 'lx-kw', name: '酷我源', filename: 'kw.js', enabled: true }],
      [{ id: 'lx-kw', name: '酷我源', filename: 'kw.js', enabled: false }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'lx-kw',
      title: '酷我源',
      playback: expect.objectContaining({ id: 'lx-kw' }),
      download: expect.objectContaining({ id: 'lx-kw' }),
    });
  });

  it('keeps same-name sources separate when their stable ids differ', async () => {
    const { mergeSourceRows } = await loadMusicModule();

    const rows = mergeSourceRows(
      [{ id: 'kw-primary', name: '酷我源', filename: 'kw-primary.js', enabled: true }],
      [{ id: 'kw-fork', name: '酷我源', filename: 'kw-fork.js', enabled: false }],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key).sort()).toEqual(['kw-fork', 'kw-primary']);
    expect(rows.find((row) => row.key === 'kw-fork')).toMatchObject({
      title: '酷我源',
      playback: null,
      download: expect.objectContaining({ id: 'kw-fork' }),
    });
    expect(rows.find((row) => row.key === 'kw-primary')).toMatchObject({
      title: '酷我源',
      playback: expect.objectContaining({ id: 'kw-primary' }),
      download: null,
    });
  });
});
