import { afterEach, describe, expect, it, vi } from 'vitest';
import { KuwoProvider } from '../../src/music/platforms/providers/kw';
import { KugouProvider } from '../../src/music/platforms/providers/kg';
import { QQMusicProvider } from '../../src/music/platforms/providers/tx';
import { MiguProvider } from '../../src/music/platforms/providers/mg';
import { NeteaseProvider } from '../../src/music/platforms/providers/wy';

// 五个平台的封面高清化。这里的 URL 形态全部取自各平台线上接口的真实返回，
// 目标尺寸也都是实测能拿到对应像素的值（详见 docs/ui-progress/covers.md）：
//   酷我 img4.kuwo.cn/star/albumcover/<size>/ ：120 → 800（实测 120x120 → 800x800）
//   酷狗 imge.kugou.com/stdmusic/<size>/     ：{size}/400 → 800（实测 400x400 → 800x800）
//   QQ   y.gtimg.cn T002R<size>x<size>M000   ：500x500 → 800x800（1000x1000 会 404，故不用）
//   咪咕 img1/img2/img3 = 200/400/800，取 img3；榜单按 imgSizeType 取最大
//   网易 al.picUrl 本身就是原图，只去掉会缩图的 ?param=

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

const originalCrypto = globalThis.crypto;

describe('封面高清化', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('酷我：把搜索结果里的 120 尺寸段换成高清尺寸段', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('search.kuwo.cn/r.s')) {
        return okJson({
          TOTAL: '1',
          abslist: [{
            MUSICRID: 'MUSIC_211513640',
            SONGNAME: '晴天',
            ARTIST: '周杰伦',
            ALBUM: '叶惠美',
            DURATION: 269,
            // 线上真实返回：短链第一段就是 120 缩略尺寸。
            web_albumpic_short: '120/s3s94/93/211513640.jpg',
          }],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await new KuwoProvider().search('晴天', 1, 1);

    expect(result.list[0].cover_url).toBe('https://img4.kuwo.cn/star/albumcover/800/s3s94/93/211513640.jpg');
  });

  it('酷我：pic120 这类缩略图字段也会被放大，且不会把更大的尺寸改小', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('nplserver.kuwo.cn/pl.svc')) {
        return okJson({
          result: 'ok',
          total: 2,
          title: '测试歌单',
          pic: 'http://img1.kwcdn.kuwo.cn/star/userpl2015/81/23/1568684821020_182253281_240.jpg',
          musiclist: [
            { MUSICRID: 'MUSIC_1', SONGNAME: 'A', pic120: 'http://img1.kwcdn.kuwo.cn/star/albumcover/120/s4s54/51/1818397081.jpg' },
            { MUSICRID: 'MUSIC_2', SONGNAME: 'B', pic: 'http://img1.kwcdn.kuwo.cn/star/albumcover/1000/s4s54/51/1818397081.jpg' },
          ],
        });
      }
      if (url.includes('artistpicserver.kuwo.cn')) {
        return new Response('NO_PIC', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await new KuwoProvider().songListDetail('123', 1, 2);

    expect(result.songs[0].cover_url).toBe('http://img1.kwcdn.kuwo.cn/star/albumcover/800/s4s54/51/1818397081.jpg');
    // 上游给的 1000 已经比目标大，保持原样。
    expect(result.songs[1].cover_url).toBe('http://img1.kwcdn.kuwo.cn/star/albumcover/1000/s4s54/51/1818397081.jpg');
    // 歌单封面尺寸写在文件名后缀里。
    expect(result.cover_url).toBe('http://img1.kwcdn.kuwo.cn/star/userpl2015/81/23/1568684821020_182253281_800.jpg');
  });

  it('酷我：artistpicserver 的兜底封面不再被降到 120', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('kbangserver.kuwo.cn/ksong.s')) {
        // 榜单条目完全没有封面字段，只能走 rid 兜底。
        return okJson({ num: 1, musiclist: [{ id: '567247828', name: '测试', artist: '测试', duration: '243' }] });
      }
      if (url.includes('artistpicserver.kuwo.cn/pic.web')) {
        return new Response('http://img1.kwcdn.kuwo.cn/star/albumcover/700/s4s54/51/1818397081.jpg', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await new KuwoProvider().leaderboardList('kw__93', 1, 1);

    expect(result.songs[0].cover_url).toBe('http://img1.kwcdn.kuwo.cn/star/albumcover/800/s4s54/51/1818397081.jpg');
  });

  it('酷狗：{size} 占位符与写死的尺寸段都换成高清尺寸', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      data: {
        total: 1,
        lists: [{
          SongName: '晴天',
          Singers: [{ name: '周杰伦' }],
          AlbumName: '叶惠美',
          Duration: 269,
          Audioid: 1,
          FileHash: 'hash',
          Image: 'http://imge.kugou.com/stdmusic/{size}/20230920/20230920142503632013.jpg',
        }],
      },
    })));

    const result = await new KugouProvider().search('晴天', 1, 1);

    expect(result.list[0].cover_url).toBe('http://imge.kugou.com/stdmusic/800/20230920/20230920142503632013.jpg');
  });

  it('酷狗：歌单列表封面不再把 {size} 原样透传', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      special_db: [{
        specialid: 1,
        specialname: '测试歌单',
        // 推荐歌单接口给的是写死的 240 尺寸段。
        img: 'http://c1.kgimg.com/custom/240/20201207/20201207134716994336.jpg',
      }],
    })));

    // 列表封面在网格里只占一格，且部分是 PNG（800px 接近 1MB），单独取 400。
    const recommended = await new KugouProvider().recommendedSongLists(1, 1);
    expect(recommended.list[0].cover_url).toBe('http://c1.kgimg.com/custom/400/20201207/20201207134716994336.jpg');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      data: {
        total: 1,
        info: [{
          specialid: 2,
          specialname: '搜索歌单',
          // 歌单搜索接口给的是 {size} 占位符。
          imgurl: 'http://imge.kugou.com/soft/collection/{size}/20260414/20260414170554928435.png',
        }],
      },
    })));

    const searched = await new KugouProvider().songListSearch('测试', 1, 1);
    expect(searched.list[0].cover_url).toBe('http://imge.kugou.com/soft/collection/400/20260414/20260414170554928435.png');
    expect(searched.list[0].cover_url).not.toContain('{size}');
  });

  it('QQ：专辑与歌手封面都用 800x800，歌单封面用白名单里的 600', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      code: 0,
      req: {
        code: 0,
        data: {
          meta: { estimate_sum: 2 },
          body: {
            item_song: [
              { id: 1, mid: 'a', name: '晴天', singer: [{ name: '周杰伦', mid: '0025NhlN2yWrP4' }], album: { mid: '000MkMni19ClKG', name: '叶惠美' }, interval: 269, file: { media_mid: 'm1' } },
              { id: 2, mid: 'b', name: '无专辑', singer: [{ name: '周杰伦', mid: '0025NhlN2yWrP4' }], interval: 100, file: { media_mid: 'm2' } },
            ],
          },
        },
      },
    })));

    const result = await new QQMusicProvider().search('晴天', 1, 2);

    expect(result.list[0].cover_url).toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg');
    expect(result.list[1].cover_url).toBe('https://y.gtimg.cn/music/photo_new/T001R800x800M0000025NhlN2yWrP4.jpg');

    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      data: {
        sum: 1,
        list: [{
          dissid: '3805603854',
          dissname: '周杰伦歌曲大全',
          imgurl: 'http://p.qpic.cn/music_cover/gaSSCRswoq7NlpHA8vK1PlQBJ2PTPia46icDP0S5LXEvDwJF2lgPh6fQ/300',
        }],
      },
    })));

    const lists = await new QQMusicProvider().songListSearch('周杰伦', 1, 1);
    expect(lists.list[0].cover_url).toBe('http://p.qpic.cn/music_cover/gaSSCRswoq7NlpHA8vK1PlQBJ2PTPia46icDP0S5LXEvDwJF2lgPh6fQ/600');
  });

  it('咪咕：搜索取 img3（800px），榜单按 imgSizeType 取最大而不是取第一个', async () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { md5: vi.fn(() => 'sign') } });
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      songResultData: {
        totalCount: 1,
        resultList: [[{
          name: '我的地盘',
          songId: '1',
          singerList: [{ name: '周杰伦' }],
          img1: '/data/oss/resource/00/41/zf/small.webp',
          img2: '/data/oss/resource/00/41/zf/medium.webp',
          img3: '/data/oss/resource/00/41/zf/large.webp',
        }]],
      },
    })));

    const result = await new MiguProvider().search('我的地盘', 1, 1);
    expect(result.list[0].cover_url).toBe('http://d.musicapp.migu.cn/data/oss/resource/00/41/zf/large.webp');

    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { md5: vi.fn(() => 'sign') } });
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      columnInfo: {
        columnTitle: '热歌榜',
        contents: [{
          objectInfo: {
            name: '榜单歌曲',
            songId: '2',
            singerList: [{ name: '周杰伦' }],
            // 线上返回的顺序不固定，这里故意把最小的排在最前面。
            albumImgs: [
              { imgSizeType: '01', img: 'https://d.musicapp.migu.cn/small.webp' },
              { imgSizeType: '03', img: 'https://d.musicapp.migu.cn/large.webp' },
              { imgSizeType: '02', img: 'https://d.musicapp.migu.cn/medium.webp' },
            ],
          },
        }],
      },
    })));

    const board = await new MiguProvider().leaderboardList('mg__27186466', 1, 1);
    expect(board.songs[0].cover_url).toBe('https://d.musicapp.migu.cn/large.webp');
  });

  it('网易云：保留原图地址，只剥掉会把图缩小的 param', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v6/playlist/detail')) {
        return okJson({
          playlist: {
            name: '飙升榜',
            trackCount: 1,
            coverImgUrl: 'https://p1.music.126.net/rIi7Qzy2i2Y_1QD7cd0MYA==/109951170048506929.jpg?param=140y140',
            trackIds: [{ id: 1 }],
            tracks: [{
              id: 1,
              name: '屋顶',
              ar: [{ name: '周杰伦' }],
              al: { id: 9, name: '范特西', picUrl: 'http://p1.music.126.net/81BsxxhomJ4aJZYvEbyPkw==/109951165671182684.jpg?param=130y130' },
              dt: 180000,
            }],
          },
        });
      }
      if (url.includes('/api/song/detail')) {
        return okJson({ songs: [] });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await new NeteaseProvider().songListDetail('19723756', 1, 1);

    expect(result.cover_url).toBe('https://p1.music.126.net/rIi7Qzy2i2Y_1QD7cd0MYA==/109951170048506929.jpg');
    expect(result.songs[0].cover_url).toBe('http://p1.music.126.net/81BsxxhomJ4aJZYvEbyPkw==/109951165671182684.jpg');
  });
});
