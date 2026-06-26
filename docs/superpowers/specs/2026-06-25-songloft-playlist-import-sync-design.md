# Starlight Songloft 歌单导入、同步与音源兼容修复设计

日期: 2026-06-25

## 1. 目标

本设计文档覆盖下一轮修改范围:

1. 修改前备份当前版本代码，包含已跟踪改动和未跟踪源码文件，但不把本地参考目录记录到仓库。
2. 修复同一音源在 LX Music Desktop 可解析、在 Starlight 报 `unknown error` 的兼容问题。
3. 搜索歌曲、外部歌单详情歌曲、自建歌单歌曲、排行榜歌曲都能加入指定 Songloft 歌单。
4. 外部歌单搜索结果可以整单导入 Songloft，并在 Songloft 中创建一个新歌单。
5. Starlight 的“我的歌单”可以同步到 Songloft 歌单，也可以读取 Songloft 原生歌单。
6. 所有导入路径都保留已有封面和歌词同步能力。

本文档只做修改设计，不直接修改业务代码。

## 2. 当前结论

### 2.1 LX 音源解析差异

对比 `lyswhut/lx-music-desktop` 后，主要差异在 `lx.request` shim:

- LX Desktop 的 `window.lx.request` 回调会传入 `{ statusCode, statusMessage, headers, bytes, raw, body }`，其中 `body` 会尝试 JSON parse。
- Starlight 当前 `src/music/lx_shim.ts` 只把响应正文作为字符串放进 `body` 和 `data`，导致很多按 LX 文档写的音源执行 `resp.body.url` 时拿到 `undefined`。
- Starlight 的 `SourceRuntime.dispatchMusicUrl()` 会把这些失败折叠成 `null`，上层再转为播放地址解析失败，用户侧就容易看到泛化的 `unknown error`。

修复方向:

- 将 `lx.request` 返回结构对齐 LX Desktop。
- 支持 JSON body 自动解析，同时保留 raw text。
- 保留 callback 签名 `(err, resp, body)`。
- 返回取消函数，兼容 LX 文档行为。
- `dispatchError` 继续记录真实错误消息，避免吞掉根因。

### 2.2 Songloft 歌单接口依据

Songloft Swagger 中与本设计相关的接口:

- `GET /api/v1/playlists`: 获取歌单列表。
- `POST /api/v1/playlists`: 创建歌单。
- `GET /api/v1/playlists/{id}/songs`: 获取歌单歌曲。
- `POST /api/v1/playlists/{id}/songs`: 向歌单批量添加歌曲，body 为 `{ "song_ids": [...] }`。
- `POST /api/v1/songs/remote`: 批量添加网络歌曲，返回导入后的 Songloft song id。
- `PUT /api/v1/songs/{id}/lyrics`: 导入成功后补写歌词。

现有插件已经有:

- `BridgeService.importSongs()` 和 `importSongsBestEffort()`，负责解析播放 URL、导入远程歌曲、补写歌词。
- `CustomPlaylistService.syncToSongloftPlaylist()`，已有自建歌单同步雏形。
- `registerSongloftLibraryHandlers()`，已有读取 Songloft 曲库、歌单和歌单歌曲的路由。
- 前端 `music_modules/custom_playlists.js` 和 `songloft_library.js`，已有“我的歌单”和 Songloft 曲库 UI 雏形。

下一轮实现应复用这些边界，不新增一套平行系统。

## 3. 备份策略

修改业务代码前先做一次本地备份，目标是能恢复“当前工作区状态”，包括未提交文件。

### 3.1 备份内容

需要备份:

- Git 当前 HEAD 的 bundle。
- 当前 tracked 文件 diff。
- 当前未跟踪但属于项目源码的文件，如 `static/js/*_modules/`、`static/js/shared/`、新增测试和 docs。
- 当前 `git status --short` 输出。

不纳入备份和仓库记录:

- `_refs/`
- `dist/`
- `node_modules/`
- `.worktrees/`
- `.superpowers/`
- 本地账号、token、`.songloft-dev.json`

### 3.2 推荐备份位置

使用仓库外目录:

```text
J:\plugin-backups\starlight\2026-06-25-HHMMSS\
```

目录内容:

```text
HEAD.bundle
workspace.diff
status.txt
untracked-src.zip
```

### 3.3 执行方式

推荐新增一个一次性执行步骤，不强制纳入长期脚本:

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
$backup = "J:\plugin-backups\starlight\$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
git bundle create "$backup\HEAD.bundle" HEAD
git status --short > "$backup\status.txt"
git diff --binary > "$backup\workspace.diff"
git ls-files --others --exclude-standard |
  Where-Object { $_ -notmatch '^(_refs|dist|node_modules|\\.worktrees|\\.superpowers)/' } |
  Compress-Archive -DestinationPath "$backup\untracked-src.zip" -Force
```

如果 `Compress-Archive` 的管道输入不能按预期保留文件，应改用临时目录复制未跟踪源码后再压缩。

## 4. Songloft 目标歌单选择设计

### 4.1 为什么不用每行内嵌下拉框

搜索结果、歌单详情、排行榜和我的歌单详情都会出现歌曲列表。如果每一行都放一个 Songloft 歌单下拉框，会导致界面拥挤、移动端溢出、状态难维护。

推荐方案: 统一使用一个“Songloft 目标歌单”选择弹窗。

### 4.2 目标歌单弹窗

触发入口:

- 搜索结果: `加入 Songloft 歌单`
- 外部歌单详情: `加入选中到 Songloft`
- 我的歌单详情: `加入选中到 Songloft`
- 排行榜详情: `加入选中到 Songloft`
- 单曲行: `加入 Songloft`

弹窗内容:

- 已有 Songloft 歌单下拉列表。
- 搜索/过滤输入框，用于快速定位歌单。
- `刷新` 按钮，重新请求 Songloft 歌单。
- `新建歌单` 输入框，可直接输入新歌单名。
- `确认加入` 主按钮。
- 当前待加入歌曲数量提示。

选择规则:

- 用户选中已有歌单时，使用该歌单 id。
- 用户输入新歌单名时，后端先创建 Songloft 歌单，再添加歌曲。
- 如果既选中已有歌单又输入新歌单名，优先使用新歌单名，并在 UI 上给出明确提示。
- 成功后保存最近使用的 Songloft 歌单 id 到前端状态，可选持久化到 localStorage。

前端状态新增:

```js
state.songloftTargetPlaylistId = ''
state.songloftTargetPlaylistName = ''
state.songloftTargetPlaylists = []
state.songloftTargetPendingSongs = []
```

建议新增模块:

```text
static/js/music_modules/songloft_playlist_target.js
```

职责:

- 加载 Songloft 歌单列表。
- 打开/关闭目标歌单弹窗。
- 接收任意来源的歌曲数组。
- 调用后端“导入并加入歌单”接口。
- 统一 toast 成功/失败信息。

## 5. 后端服务设计

### 5.1 新增服务边界

建议新增:

```text
src/songloft/playlists.ts
```

或在 `src/bridge/` 下新增:

```text
src/bridge/songloft_playlists.ts
```

推荐命名: `SongloftPlaylistService`。

职责:

- 读取 Songloft 歌单。
- 创建 Songloft 歌单。
- 把已有 Songloft song ids 添加到歌单。
- 把 `SearchResultSong[]` 导入为 Songloft remote songs，再添加到歌单。
- 为整单导入提供分页加载、导入、创建歌单、添加歌曲的一站式流程。

不要把这些逻辑塞进前端，也不要让 UI 直接调用 Songloft `/api/v1/*`，这样可以复用 token、错误清洗、歌词补写和重复导入处理。

### 5.2 新增插件 API

建议新增以下插件内路由:

```text
GET  /api/songloft/playlists
POST /api/songloft/playlists
POST /api/songloft/playlists/:id/song-ids
POST /api/songloft/playlists/:id/import-songs
POST /api/songloft/playlists/import-songs
POST /api/songloft/playlists/import-source-songlist
POST /api/songloft/playlists/import-custom-playlist/:id
POST /api/songloft/playlists/:id/import-to-custom
```

说明:

- `GET /api/songloft/playlists` 已存在，保留并增强分页兼容。
- `POST /api/songloft/playlists` 创建 Songloft 歌单，body: `{ name }`。
- `POST /api/songloft/playlists/:id/song-ids` 把已有 Songloft 歌曲添加到歌单，body: `{ song_ids }`。
- `POST /api/songloft/playlists/:id/import-songs` 把搜索/排行/歌单详情里的 `SearchResultSong[]` 导入远程歌曲，再添加到指定 Songloft 歌单。
- `POST /api/songloft/playlists/import-songs` 支持 body: `{ playlist_id?, playlist_name?, songs }`，用于目标弹窗统一提交。
- `POST /api/songloft/playlists/import-source-songlist` 支持 body: `{ source_id, id, quality, playlist_name? }`，用于外部歌单搜索结果整单导入并创建 Songloft 歌单。
- `POST /api/songloft/playlists/import-custom-playlist/:id` 用于“我的歌单”同步到指定或新建 Songloft 歌单。
- `POST /api/songloft/playlists/:id/import-to-custom` 可选，用于把 Songloft 原生歌单导入为 Starlight 我的歌单快照。

如果实现时觉得路由过多，可以先保留核心四个:

```text
POST /api/songloft/playlists
POST /api/songloft/playlists/import-songs
POST /api/songloft/playlists/import-source-songlist
POST /api/songloft/playlists/import-custom-playlist/:id
```

### 5.3 导入并加入歌单的数据流

对 `SearchResultSong[]`:

1. 接收 `{ playlist_id }` 或 `{ playlist_name }` 和 `songs`。
2. 如果只有 `playlist_name`，先创建 Songloft 歌单。
3. 调用 `BridgeService.importSongsBestEffort(songs)`。
4. 从返回的 `songs` 中提取 Songloft song ids。
5. 调用 Songloft `POST /api/v1/playlists/{id}/songs`，body 为 `{ song_ids }`。
6. 返回 `{ playlist, imported, added, skipped, errors }`。

对已有 Songloft 歌曲:

1. 接收 native song ids。
2. 直接调用 `POST /api/v1/playlists/{id}/songs`。
3. 不重新导入，不补写歌词。

对外部歌单搜索结果整单导入:

1. 前端传入 `source_id`、`id`、`quality` 和可选 `playlist_name`。
2. 后端使用对应 `MusicPlatformProvider.songListDetail()` 分页加载完整歌单。
3. 如果未传 `playlist_name`，默认使用外部歌单名。
4. 创建 Songloft 歌单。
5. 将完整歌曲列表导入为远程歌曲。
6. 添加到新建歌单。
7. 返回总数、成功数、跳过数和失败列表。

## 6. 前端功能设计

### 6.1 搜索歌曲加入 Songloft 歌单

现有搜索结果已有多选和批量操作。新增/改造:

- 保留 `导入 Songloft 歌曲库`，表示只导入曲库。
- 新增 `加入 Songloft 歌单`，打开目标歌单弹窗。
- 单曲行新增 `加入 Songloft`，使用同一个弹窗。
- 弹窗确认后调用 `api/songloft/playlists/import-songs`。

成功提示:

```text
已加入 Songloft 歌单：成功 12 首，跳过 1 首
```

失败提示展示最后失败原因，并提供到诊断日志的引导。

### 6.2 外部歌单搜索结果整单导入 Songloft

歌单搜索结果行新增:

- `导入我的歌单`: 保留现有逻辑，进入 Starlight 我的歌单。
- `导入 Songloft 歌单`: 新建 Songloft 歌单并导入整单。
- `查看歌曲`: 打开详情。

点击 `导入 Songloft 歌单`:

1. 弹出确认弹窗，显示歌单名、来源和预计歌曲数。
2. 允许修改即将创建的 Songloft 歌单名。
3. 后端分页拉取完整外部歌单。
4. 导入 remote songs 并添加到新歌单。

注意:

- 不依赖当前详情页已加载的分页数据，后端必须重新按页拉取完整列表。
- 质量使用当前歌单页选择的 quality，默认继续使用 `flac24bit`。

### 6.3 外部歌单详情歌曲加入 Songloft 歌单

歌单详情页新增:

- 每行 `加入 Songloft`。
- 顶部 `加入选中到 Songloft`。
- 顶部可显示当前目标歌单名，但实际选择仍通过统一弹窗完成。

只对当前详情页已加载歌曲操作；如果用户想整单导入，应使用歌单搜索结果行的 `导入 Songloft 歌单`。

### 6.4 我的歌单同步到 Songloft

当前已有 `同步 Songloft 歌单` 按钮。下一轮改造为:

- 对自建歌单: 可同步到已有 Songloft 歌单，或新建同名 Songloft 歌单。
- 对外部导入的我的歌单: 同样支持同步到 Songloft，后端会按歌名/歌手重新解析可播放源。
- 同步完成后保存 `native_playlist_id`，下次默认同步到同一个 Songloft 歌单。

前端交互:

- 按钮文案: `同步到 Songloft`
- 首次同步打开目标歌单弹窗，默认新建同名 Songloft 歌单。
- 已绑定 `native_playlist_id` 的歌单再次同步时，默认选中已绑定歌单，但仍允许切换。

### 6.5 获取 Songloft 歌单到我的歌单

Songloft 曲库面板已有读取 Songloft 歌单能力。新增:

- Songloft 原生歌单行增加 `导入我的歌单`。
- 点击后读取该 Songloft 歌单歌曲，创建一个 Starlight 我的歌单快照。
- 快照歌曲保留 title、artist、album、duration、cover_url 和 native song id。
- 如果后续要重新同步回 Songloft，已有 native song id 的歌曲优先直接添加，不重新搜索。

这可以解决“我的歌单也能获取 Songloft 歌单”的需求。

### 6.6 我的歌单详情歌曲加入 Songloft 歌单

我的歌单详情页新增:

- 每行 `加入 Songloft`。
- 顶部 `加入选中到 Songloft`。

处理规则:

- 有 `source_data` 的歌曲走 remote song 导入。
- 只有 title/artist 的便携歌曲先通过 `BridgeService.resolveSearchSong()` 解析，再导入。
- 已有 native song id 的歌曲直接添加到目标歌单。

### 6.7 排行榜歌曲加入 Songloft 歌单

排行榜详情页新增:

- 每行 `加入 Songloft`。
- 顶部 `加入选中到 Songloft`。

数据流与搜索歌曲一致，直接把 `SearchResultSong[]` 交给 `api/songloft/playlists/import-songs`。

## 7. 数据模型和去重

### 7.1 Remote song 去重

继续使用现有 `toRemoteSong()` 生成的:

- `plugin_entry_path`
- `dedup_key`
- `source_data`

如果 `POST /api/v1/songs/remote` 遇到重复:

- 沿用现有逐首导入回退逻辑。
- 如果 Songloft 不返回已存在歌曲 id，后续应增加“按 plugin_entry_path + dedup_key 查询已存在歌曲”的能力；如果没有查询接口，先记录跳过。

### 7.2 Playlist add 去重

Songloft `POST /playlists/{id}/songs` 文档说明会跳过已存在歌曲。插件无需本地重复过滤，但应返回 Songloft 的添加结果。

### 7.3 自建歌单与 Songloft 歌单关系

`CustomPlaylist` 保留:

```ts
native_playlist_id?: string | number
```

新增可选字段:

```ts
native_playlist_name?: string
native_synced_at?: string
```

用于 UI 显示“已同步到 xxx”。

## 8. 错误处理

### 8.1 音源解析失败

修复 `lx.request` 后，仍可能出现音源自身失败。错误消息应包含:

- 尝试了几个音源。
- 最后失败原因。
- 当前 source id / source name。

避免只显示 `unknown error`。

### 8.2 批量导入部分失败

批量导入不应因为单首失败中断整批。返回结构:

```ts
{
  playlist: unknown
  imported: number
  added: number
  skipped: number
  errors: Array<{ title: string; message: string }>
}
```

前端 toast 展示摘要，详情可进入诊断日志查看。

### 8.3 歌词同步失败

保持已有策略:

- 歌曲导入成功后异步补写歌词。
- 歌词失败不回滚歌曲，也不阻断加入歌单。
- 记录 warning。

## 9. 测试计划

### 9.1 后端测试

新增或扩展:

- `tests/music/runtime.test.ts`
  - LX FAQ 示例中的 `resp.body.url` 能正常返回 URL。
  - `lx.request` callback 的 `body` 为 JSON 对象，`raw`/文本字段可用。
  - request 失败时 dispatchError 保留真实错误。

- `tests/bridge/service.test.ts`
  - `importSongsBestEffort()` 返回导入后的 Songloft song ids。
  - 歌词补写失败不影响导入结果。

- `tests/handlers/songloft_library.test.ts`
  - 创建 Songloft 歌单。
  - 将已有 song ids 加入歌单。
  - 将 `SearchResultSong[]` 导入并加入已有歌单。
  - 传 `playlist_name` 时创建新歌单再添加歌曲。
  - 整个外部歌单导入会分页加载完整歌曲。

- `tests/custom_playlists/service.test.ts`
  - 自建歌单同步到已有 Songloft 歌单。
  - 自建歌单首次同步创建同名 Songloft 歌单。
  - Songloft 原生歌单导入为我的歌单快照。

### 9.2 前端测试

新增或扩展:

- `tests/ui/static_layout.test.ts`
  - 搜索、歌单详情、我的歌单详情、排行详情都有 `加入 Songloft` 控件。
  - 存在统一 Songloft 目标歌单弹窗。

- `tests/ui/songloft_library.test.ts`
  - 能加载 Songloft 歌单并打开目标选择。
  - Songloft 原生歌单可以导入我的歌单。

- `tests/ui/music_search.test.ts`
  - 选中搜索歌曲后调用 `api/songloft/playlists/import-songs`。

- `tests/ui/music_songlists_rankings.test.ts`
  - 外部歌单整单导入调用 `api/songloft/playlists/import-source-songlist`。
  - 歌单详情选中歌曲加入 Songloft 歌单。
  - 排行榜选中歌曲加入 Songloft 歌单。

- `tests/ui/custom_playlists.test.ts`
  - 我的歌单详情选中歌曲加入 Songloft 歌单。
  - 已绑定 native playlist 时同步默认使用该歌单。

## 10. 分阶段实施顺序

### 阶段 0: 备份

- 执行第 3 节备份步骤。
- 保存备份路径到本轮进度记录或最终说明。
- 不提交 `_refs/`。

验收:

- 备份目录存在。
- `status.txt`、`workspace.diff`、`HEAD.bundle` 存在。

### 阶段 1: LX shim 兼容修复

- 先写失败测试，复现 LX FAQ 示例。
- 修改 `src/music/lx_shim.ts`。
- 验证 `runtime.test.ts`。

验收:

- 同样音源的 `resp.body.url` 能正常解析。
- 失败原因不再只剩 `unknown error`。

### 阶段 2: Songloft Playlist 后端服务

- 新增 `SongloftPlaylistService`。
- 新增创建歌单、添加 song ids、导入并添加歌曲接口。
- 复用 `BridgeService.importSongsBestEffort()`。

验收:

- 后端 handler 测试覆盖创建、添加、导入、部分失败。

### 阶段 3: 统一目标歌单弹窗

- 新增前端模块 `songloft_playlist_target.js`。
- 从搜索页接入。
- 保存最近选择的目标歌单。

验收:

- 搜索结果可批量加入指定 Songloft 歌单。

### 阶段 4: 外部歌单与排行榜接入

- 歌单搜索结果新增整单导入 Songloft。
- 歌单详情新增选中加入 Songloft。
- 排行榜详情新增选中加入 Songloft。

验收:

- 整单导入会在 Songloft 创建新歌单。
- 详情页只导入选中歌曲。

### 阶段 5: 我的歌单与 Songloft 原生歌单互通

- 改造 `syncCustomPlaylistToSongloft()` 支持目标选择。
- Songloft 歌单列表增加 `导入我的歌单`。
- 我的歌单详情增加 `加入 Songloft`。

验收:

- 我的歌单能同步到 Songloft。
- Songloft 原生歌单能生成 Starlight 我的歌单快照。

### 阶段 6: 完整验证和打包

执行:

```powershell
npm run typecheck
npm test
npm run build
npm run validate
```

验收:

- 所有测试通过。
- 生成新的 `dist/starlight.jsplugin.zip`。
- `git status --short` 只包含预期源码、测试和文档变更。

## 11. 风险和取舍

### 11.1 Songloft 已存在歌曲 id 获取

如果 `/songs/remote` 遇到重复但不返回已存在歌曲 id，插件无法可靠把这首重复歌曲加入歌单。

优先方案:

- 继续使用逐首导入。
- 能拿到 id 的就加入歌单。
- 拿不到 id 的记录为 skipped，并显示原因。

后续优化:

- 如果 Songloft 提供按 `plugin_entry_path + dedup_key` 查询歌曲接口，再补齐重复歌曲加入能力。

### 11.2 整单导入耗时

外部歌单可能很大，逐首解析 URL 和歌词会耗时。

策略:

- 后端分批处理，前端显示进行中状态。
- 第一版可以同步请求完成后返回，但要避免浏览器重复点击。
- 如果测试环境出现 504，再升级为后台任务 + 进度轮询。

### 11.3 UI 密度

新增按钮很多，容易挤压列表行。

策略:

- 单行只保留高频按钮。
- 批量功能放在 section bar。
- Songloft 目标歌单用弹窗统一承载，不在每行塞下拉框。

## 12. 最终验收清单

- 修改前已备份当前工作区。
- `_refs/` 保留为本地参考目录，但不加入仓库。
- LX FAQ 示例音源可以通过 Starlight shim 正常解析播放 URL。
- 搜索歌曲可以加入指定 Songloft 歌单。
- 外部歌单搜索结果可以整单导入 Songloft 并创建新歌单。
- 外部歌单详情歌曲可以加入指定 Songloft 歌单。
- 我的歌单可以同步到 Songloft 歌单。
- Songloft 原生歌单可以被读取，并可导入为我的歌单快照。
- 我的歌单详情歌曲可以加入指定 Songloft 歌单。
- 排行榜详情歌曲可以加入指定 Songloft 歌单。
- 导入歌曲仍保留封面和歌词补写。
- 批量导入部分失败时返回明确统计和错误详情。
- `npm run typecheck`、`npm test`、`npm run build`、`npm run validate` 全部通过。
