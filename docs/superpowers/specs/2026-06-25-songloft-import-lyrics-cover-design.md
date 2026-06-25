# Songloft 导入时同步保存封面和歌词设计

## 目标

在插件里点击“导入 Songloft 歌曲库”时，除了现有的歌曲基础信息和播放源信息，还要把封面和歌词一并保存到 Songloft。

这次改动只覆盖导入链路，不处理 `tx` / `wy` 搜索问题，也不改现有歌曲搜索、歌单展示或歌词单独查询接口。

## 方案

- 导入入口仍复用 `BridgeService.importSongs()` 和 `BridgeService.importSongsBestEffort()`。
- 远程歌曲首次导入时，继续通过 `POST /api/v1/songs/remote` 提交 `cover_url`，保证封面随歌曲一起落库。
- 歌曲导入成功后，基于返回的 Songloft 歌曲 `id`，调用 `PUT /api/v1/songs/{id}/lyrics` 补写歌词。
- 歌词抓取不新建实现，直接复用现有 `src/music/platforms/lyrics.ts` 的平台歌词解析逻辑。
- 歌词写入使用 Songloft 原生歌词结构：
  - `lyric` 保存主歌词
  - `tlyric` 保存翻译歌词
  - `rlyric` 保存罗马音歌词
  - `lxlyric` 保存逐字歌词
  - `lyric_source` 固定写为 `scraped`

## 数据流

1. 插件收到一个或多个待导入的 `SearchResultSong`。
2. 先解析播放 URL，并构造远程歌曲 payload。
3. 调用 `POST /api/v1/songs/remote` 导入歌曲，payload 中保留 `cover_url`。
4. 从导入响应里取回每首歌对应的 Songloft `id`。
5. 对每首成功导入且保留了 `source_data` 的歌曲，调用平台歌词解析器获取歌词。
6. 将歌词结果提交到 `PUT /api/v1/songs/{id}/lyrics`。

## 失败处理

- 如果歌曲导入失败，保持现有错误行为，不进入歌词写入阶段。
- 如果歌曲导入成功但歌词解析失败，不回滚歌曲导入；歌曲和封面保留，只记录 warning。
- 如果歌词接口写入失败，不回滚歌曲导入；返回值仍以歌曲导入结果为准，只记录 warning。
- 对重复导入场景，沿用现有逐首回退逻辑；只要能拿到 Songloft 歌曲记录，就尝试补写歌词。

## 影响范围

- `src/bridge/service.ts`：导入后补写歌词的主流程。
- `src/bridge/mapper.ts`：如有必要，补充远程导入 payload 字段测试。
- `tests/bridge/service.test.ts`：覆盖封面随导入提交、歌词补写成功、歌词补写失败不回滚、重复导入场景。

## 测试

- BridgeService 测试先写失败用例，再实现：
  - 导入 payload 包含 `cover_url`
  - 导入成功后会请求 Songloft 歌词更新接口
  - 歌词接口收到 `lyric` / `tlyric` / `rlyric` / `lxlyric` / `lyric_source`
  - 歌词抓取失败时，歌曲导入结果仍成功
  - 歌词写入失败时，歌曲导入结果仍成功
