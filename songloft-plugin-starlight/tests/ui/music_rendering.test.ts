import { describe, expect, it } from 'vitest';

interface MusicRenderingModule {
  cleanDisplayText(value: unknown): string;
  mediaCoverUrl(item: Record<string, unknown>): string;
  renderSongRow(song: Record<string, unknown>, index: number, extraActions?: string): string;
  renderSongListItem(item: Record<string, unknown>, index: number): string;
  renderRankingBoard(board: Record<string, unknown>, index: number): string;
}

async function loadMusicModule(): Promise<MusicRenderingModule> {
  const modulePath = '../../static/js/music.js';
  return await import(modulePath) as MusicRenderingModule;
}

describe('music media rendering', () => {
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
    expect(html).toContain('播放');
    expect(html).toContain('data-action="download"');
    expect(html).toContain('>下载</button>');
    expect(html).toContain('导入 Songloft 歌曲库');
    expect(html).not.toContain('>试听<');
    expect(html).not.toContain('>导入<');
    expect(html).not.toContain('228908');
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
});
