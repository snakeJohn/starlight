import { describe, expect, it } from 'vitest';

interface MusicModule {
  renderPagination(options: {
    scope: string;
    page: number;
    total: number;
    pageSize: number;
  }): string;
}

async function loadMusicModule(): Promise<MusicModule> {
  const modulePath = '../../static/js/music.js';
  return await import(modulePath) as MusicModule;
}

describe('music pagination helpers', () => {
  it('renders previous, current, next, and jump controls for paged lists', async () => {
    const { renderPagination } = await loadMusicModule();

    const html = renderPagination({ scope: 'search', page: 2, total: 95, pageSize: 30 });

    expect(html).toContain('data-pagination="search"');
    expect(html).toContain('data-page-action="prev"');
    expect(html).toContain('第 2 / 4 页');
    expect(html).toContain('data-page-action="next"');
    expect(html).toContain('data-role="search-page-input"');
    expect(html).toContain('data-page-action="jump"');
  });

  it('disables impossible page actions at list boundaries', async () => {
    const { renderPagination } = await loadMusicModule();

    const firstPage = renderPagination({ scope: 'ranking', page: 1, total: 30, pageSize: 30 });
    const lastPage = renderPagination({ scope: 'ranking', page: 3, total: 90, pageSize: 30 });

    expect(firstPage).toContain('data-page-action="prev" disabled');
    expect(lastPage).toContain('data-page-action="next" disabled');
  });
});
