import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicRenderingModule {
  cleanDisplayText(value: unknown): string;
  mediaCoverUrl(item: Record<string, unknown>): string;
  renderSongRow(
    song: Record<string, unknown>,
    index: number,
    extraActions?: string,
    options?: { selectable?: boolean; checkboxRole?: string },
  ): string;
  renderListScroller(innerHtml: string, extraClass?: string): string;
  renderSongListItem(item: Record<string, unknown>, index: number): string;
  renderRankingBoard(board: Record<string, unknown>, index: number): string;
  renderDownloadProgressMarkup(progress: Record<string, unknown> | null): string;
}

async function loadMusicModule(): Promise<MusicRenderingModule> {
  const modulePath = '../../static/js/music.js';
  return await import(modulePath) as MusicRenderingModule;
}

describe('music media rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders song rows with cover artwork and without stable provider ids', async () => {
    const { renderSongRow } = await loadMusicModule();

    const html = renderSongRow({
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: 269,
      cover_url: 'https://img.test/song.jpg',
      source_data: {
        platform: 'kw',
        songmid: '228908',
        quality: '320k',
      },
    }, 0);

    expect(html).toContain('https://img.test/song.jpg');
    expect(html).toContain('晴天');
    expect(html).toContain('周杰伦');
    expect(html).not.toContain('data-action="preview"');
    expect(html).not.toContain('>播放</button>');
    expect(html).toContain('data-action="download"');
    expect(html).toContain('>下载</button>');
    expect(html).toContain('导入 Songloft 歌曲库');
    expect(html).not.toContain('>试听<');
    expect(html).not.toContain('>导入<');
    expect(html).not.toContain('228908');
  });

  it('can render selectable song rows without a visible local play button', async () => {
    const { renderSongRow } = await loadMusicModule();

    const html = renderSongRow({
      title: '稻香',
      artist: '周杰伦',
      source_data: {
        platform: 'kw',
        quality: '320k',
      },
    }, 3, '', { selectable: true, checkboxRole: 'search-song-check' });

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('data-role="search-song-check"');
    expect(html).toContain('data-index="3"');
    expect(html).not.toContain('data-action="preview"');
    expect(html).not.toContain('>播放</button>');
    expect(html).toContain('data-action="speaker"');
    expect(html).toContain('>推送音箱</button>');
  });

  it('wraps long list content in a stable scroll container', async () => {
    const { renderListScroller } = await loadMusicModule();

    const html = renderListScroller('<article>歌曲</article>', 'search-results-scroll');

    expect(html).toContain('class="list-scroll search-results-scroll"');
    expect(html).toContain('<article>歌曲</article>');
  });

  it('renders discovered songlists with cover artwork while hiding raw ids', async () => {
    const { renderSongListItem } = await loadMusicModule();

    const html = renderSongListItem({
      id: '3360244412',
      name: '华语热歌',
      cover_url: 'https://img.test/list.jpg',
      creator: '洛雪精选',
    }, 0);

    expect(html).toContain('https://img.test/list.jpg');
    expect(html).toContain('华语热歌');
    expect(html).toContain('洛雪精选');
    expect(html).toContain('收藏');
    expect(html).toContain('data-action="favorite-songlist"');
    expect(html).not.toContain('3360244412');
  });

  it('cleans escaped songlist descriptions before rendering', async () => {
    const { cleanDisplayText, renderSongListItem } = await loadMusicModule();

    const raw = '河图精选。\\\\u003cbr\\\\u003e<strong>古风</strong>&amp;国风';
    const cleaned = cleanDisplayText(raw);
    const html = renderSongListItem({
      name: '河图歌单',
      desc: raw,
    }, 0);

    expect(cleaned).toBe('河图精选。 古风&国风');
    expect(html).toContain('河图精选。 古风&amp;国风');
    expect(html).not.toContain('u003cbr');
    expect(html).not.toContain('<strong>古风</strong>');
    expect(html).not.toContain('&lt;strong&gt;');
  });

  it('renders ranking boards with a placeholder and hides provider ids', async () => {
    const { renderRankingBoard } = await loadMusicModule();

    const html = renderRankingBoard({
      id: 'kw__16',
      name: '酷我热歌榜',
      desc: '每日更新',
    }, 0);

    expect(html).toContain('media-artwork');
    expect(html).toContain('酷我热歌榜');
    expect(html).toContain('每日更新');
    expect(html).not.toContain('kw__16');
  });

  it('normalizes common cover fields from LX source results', async () => {
    const { mediaCoverUrl } = await loadMusicModule();

    expect(mediaCoverUrl({ img: 'https://img.test/img.jpg' })).toBe('https://img.test/img.jpg');
    expect(mediaCoverUrl({ pic: 'https://img.test/pic.jpg' })).toBe('https://img.test/pic.jpg');
    expect(mediaCoverUrl({ picUrl: 'https://img.test/pic-url.jpg' })).toBe('https://img.test/pic-url.jpg');
    expect(mediaCoverUrl({ imgurl: 'https://img.test/imgurl.jpg' })).toBe('https://img.test/imgurl.jpg');
    expect(mediaCoverUrl({ album_img: 'https://img.test/album.jpg' })).toBe('https://img.test/album.jpg');
    expect(mediaCoverUrl({ cover: 'https://img.test/cover.jpg' })).toBe('https://img.test/cover.jpg');
    expect(mediaCoverUrl({ source_data: { picUrl: 'https://img.test/source.jpg' } })).toBe('https://img.test/source.jpg');
  });

  it('adds the Songloft access token to protected song cover resources', async () => {
    vi.stubGlobal('window', {
      SongloftPlugin: {
        getAuthToken: () => 'ui-token',
      },
    });
    const { mediaCoverUrl, renderSongRow } = await loadMusicModule();

    expect(mediaCoverUrl({ cover_url: '/api/v1/songs/484/cover' }))
      .toBe('/api/v1/songs/484/cover?access_token=ui-token');
    expect(mediaCoverUrl({ cover_url: '/api/v1/songs/484/cover?size=small' }))
      .toBe('/api/v1/songs/484/cover?size=small&access_token=ui-token');
    expect(mediaCoverUrl({ cover_url: '/api/v1/songs/484/cover?access_token=existing' }))
      .toBe('/api/v1/songs/484/cover?access_token=existing');

    const html = renderSongRow({
      title: 'Songloft 歌曲',
      artist: '歌手',
      cover_url: 'http://192.168.31.63:18191/api/v1/songs/484/cover',
    }, 0);

    expect(html).toContain('http://192.168.31.63:18191/api/v1/songs/484/cover?access_token=ui-token');
  });

  it('ignores bare numeric cover fields that would navigate inside the plugin route', async () => {
    const { mediaCoverUrl, renderSongRow } = await loadMusicModule();

    expect(mediaCoverUrl({ cover_url: '1' })).toBe('');
    expect(mediaCoverUrl({ source_data: { songInfo: { pic: '2' } } })).toBe('');
    expect(mediaCoverUrl({ cover_url: '1', picUrl: 'https://img.test/valid.jpg' })).toBe('https://img.test/valid.jpg');

    const html = renderSongRow({
      title: '搜索结果',
      artist: '歌手',
      cover_url: '1',
      source_data: {
        platform: 'kw',
        songInfo: { pic: '2' },
      },
    }, 0);

    expect(html).toContain('media-artwork-placeholder');
    expect(html).not.toContain('src="1"');
    expect(html).not.toContain('src="2"');
  });

  it('renders download progress as a percentage bar with recent failure details', async () => {
    const { renderDownloadProgressMarkup } = await loadMusicModule();

    const html = renderDownloadProgressMarkup({
      active: true,
      current: 1,
      total: 4,
      success: 0,
      failed: 1,
      results: [{
        status: 'failed',
        error: 'audio invalid: reason=duration_mismatch_high expected=28.0s actual=252.0s',
      }],
    });

    expect(html).toContain('download-progress-track');
    expect(html).toContain('download-progress-fill');
    expect(html).toContain('style="width: 25%"');
    expect(html).toContain('25%');
    expect(html).toContain('duration_mismatch_high');
  });
});
