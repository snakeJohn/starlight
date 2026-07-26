# 五平台封面高清化 · 进度

**目标**：五个平台的封面都很模糊，找出各自的高清来源并改用。

参考实现：LX Music Desktop（`src/renderer/utils/musicSdk/<平台>/`）。
所有尺寸均为**真实抓取实测**（读 JPEG/PNG/WebP 文件头解出像素），不是照抄上游源码。

## 各平台实测（歌曲封面）

| 平台 | 改前 URL 形态 | 实测尺寸 | 改后 URL 形态 | 实测尺寸 | 是否联网验证 |
|---|---|---|---|---|---|
| 酷我 kw | `img4.kuwo.cn/star/albumcover/**120**/s3s94/93/xxx.jpg` | **120×120**（约 10KB） | `.../albumcover/**800**/s3s94/93/xxx.jpg` | **800×800**（约 190–240KB） | ✅ 已联网实测 |
| 酷狗 kg | `imge.kugou.com/stdmusic/**400**/xxx.jpg`（`{size}`→400） | **400×400**（约 71KB） | `imge.kugou.com/stdmusic/**800**/xxx.jpg` | **800×800**（约 155–250KB） | ✅ 已联网实测 |
| QQ tx | `y.gtimg.cn/music/photo_new/T002R**500x500**M000<mid>.jpg` | **500×500**（约 81KB） | `T002R**800x800**M000<mid>.jpg` | **800×800**（约 180–260KB） | ✅ 已联网实测（15/15 张专辑全部可用） |
| 咪咕 mg | `img3`（搜索/歌单）、`albumImgs[0]`（榜单） | **800×800**（img3 已是最大档） | 搜索仍取 `img3`；榜单改为按 `imgSizeType` 取最大 | **800×800** | ✅ 已联网实测 |
| 网易云 wy | `p1.music.126.net/xxx/109951….jpg`（原图，无 param） | **500×500 ~ 3648×3648**（本身就是原图） | 同上，仅剥掉上游可能带的缩图 `?param=` | 不变（已是原图） | ✅ 已联网实测 |

### 歌单 / 榜单封面（顺带修）

| 平台 | 改前 | 实测 | 改后 | 实测 | 说明 |
|---|---|---|---|---|---|
| 酷我 kw | `userpl2015/…_240.jpg`（或 `_150`） | 240×240 / 150×150 | `…_800.jpg` | **700×700**（服务端封顶 700） | 文件名后缀即尺寸 |
| 酷狗 kg | `imge.kugou.com/soft/collection/**{size}**/…`（占位符原样透传） | 400×400（靠酷狗兜底渲染器碰巧生效） | `…/collection/**400**/…`；`c1.kgimg.com/custom/240/` → `/400/` | **400×400** | 列表格子小，且部分是 PNG（800px 接近 1MB），故列表单独取 400 |
| QQ tx | `p.qpic.cn/music_cover/<id>/**300**` | 300×300 | `…/**600**` | **600×600**（原图小时按原图，如 500/521） | QQ 只接受 150/300/600/1000，**500 与 800 直接返回 400** |
| 咪咕 mg | `musicListPicUrl` 等固定地址 | 856×856 / 1124×1124 | 不动 | 同左 | 无尺寸参数可调，本身已够清晰 |
| 网易云 wy | `coverImgUrl` | 800×800 ~ 1023×1023 | 仅剥 `?param=` | 同左 | 本身即原图 |

## 与 LX Music 上游的一致 / 分歧

- **一致**：
  - kw 走 `artistpicserver.kuwo.cn/pic.web` 做兜底封面（`kw/pic.js`）——保留。
  - tx 用 `T002R…M000<albumMid>` / 无专辑时退到 `T001R…M000<singerMid>`（`tx/musicInfo.js`）——保留。
  - wy 直接用 `al.picUrl`、不做任何尺寸处理（`wy/musicSearch.js`）——保留，实测它本身就是原图。
  - kg 的 `{size}` 占位符需要替换（`kg/pic.js`、`kg/songList.js`）——保留并补齐了漏替换的地方。
- **分歧（以实测为准，已在代码注释里写明）**：
  - kw：上游 `kw/pic.js` 请求 `pictype=500&size=500`。实测 800 同样稳定返回 800×800，故取 800。
    另外本仓库原先有一段 `normalizeKwExternalCoverUrl` 把 artistpicserver 返回的地址**强行改写成 120**，
    即使请求时要的是 1000 —— 这是本次最大的一处"变糊"来源，已改成只升不降。
  - kg：上游 `kg/songList.js`、`kg/album.js` 统一填 240，实测明显偏糊；歌曲封面取 800、列表封面取 400。
  - tx：上游固定 500×500，实测 800×800 在 15/15 张专辑上都返回 800×800，故升到 800。
  - mg：上游 `mg/pic.js` 走 `music.migu.cn/v3/api/music/audioPlayer/getSongPic` 拿 `largePic`，
    但那是**每首歌一次额外请求**（N+1），本仓库不采用；搜索/歌单返回里的 `img3` 已经是 800×800，
    是咪咕在同一次请求里能拿到的最大档。

## 状态
- ✅ 读完 5 个 provider，定位所有封面 URL 产出点（搜索 / 歌单详情 / 榜单 / 歌单列表）
- ✅ 对照 LX Music Desktop 上游各平台 SDK 的封面处理
- ✅ 五平台候选 URL 全部联网实测像素尺寸
- ✅ 改写 kw / kg / tx / mg / wy
- ✅ 新增 `tests/music/cover_quality.test.ts`（8 条），并更新 kw/kg/tx 既有断言
- ✅ `npm run typecheck` 通过；`npx vitest run tests/music tests/bridge` 194 条全绿
- ✅ 直接调用改后的 provider 真实联网跑一遍，逐条量出改后像素（见上表"改后实测尺寸"）

## 回退行为
本次全部是**纯 URL 改写**，没有增加任何一次网络请求。降级策略：

1. **只升不降**：`kwLargerSize` / `kgLargerSize` / `txUpgradeListCover` 都会先比较上游给的尺寸，
   上游已经更大时保持原样（例如 kw 返回 `starheads/1000/` 就不会被改成 800）。
2. **服务端自动封顶，不会 404**：kw（`img4.kuwo.cn`、`img1.kwcdn.kuwo.cn`）与 kg（`imge.kugou.com`、`c1.kgimg.com`）
   在请求尺寸超过原图时，会直接返回最大可用尺寸（实测 kw 请求 800 → 返回 750×750，请求 1500 → 返回 1477×1477），
   HTTP 200，不会出现坏图。
3. **白名单尺寸只取实测可用值**：QQ 的 `T002R<n>x<n>` 实测 `1000x1000` 会 **404**，
   歌单封面 `music_cover/<id>/<n>` 实测 500、800 会返回 **400**，
   所以只用了实测 200 的 `800x800` 与 `600`，不做"猜一个更大的数"。
4. **正则不匹配就原样返回**：所有改写都是有前缀锚点的正则（`/star/albumcover/`、`/stdmusic/`、`/music_cover/…` 等），
   遇到没见过的域名或路径形态直接原样透传，不会构造出不存在的地址。

## 未完成 / 待决策
- 网易云 wy 无法再提高：`al.picUrl` 已经是原图，`?param=WxH` 只能缩小。
  若要控制体积（榜单里出现过 3648×3648 / 595KB 的封面），应由前端按显示尺寸补 `?param=`，
  但前端 `static/**` 不在本次改动范围内。
- 咪咕更大的图只有 `getSongPic` 单曲接口有，属于 N+1，未采用。
- kw 的 `albumCover()`（`stype=albuminfo`）实测对多个 albumid 返回 `{'musiclist':[],'songnum':'0'}`，
  这条兜底路径基本失效；本次只顺带做了尺寸归一化，没有改它的取数逻辑（超出封面清晰度这个任务范围）。
