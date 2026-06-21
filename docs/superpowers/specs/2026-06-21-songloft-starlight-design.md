# Songloft Starlight Plugin Design

日期: 2026-06-21

## 目标

重写一个新的 Songloft JS 插件，建议目录为 `J:\plugins\songloft-plugin-starlight`，插件 `entryPath` 为 `starlight`。新插件以 `J:\plugins\songloft-plugin-miot` 为主干，完整保留并整理智能音箱能力；同时引入 `J:\plugins\lxmusic.jsplugin` 和 `J:\plugins\lxserver` 中可复用的 LX Music Web 端音源、搜索、歌单、榜单和 URL 解析能力。

最终结果应是一个能安装到 Songloft 的独立插件，入口为 `/api/v1/jsplugin/starlight/`，具备米家账号登录、智能音箱控制、语音口令、定时任务、LX 音源导入、歌曲搜索、歌单搜索、推荐歌单、排行榜、歌单解析、URL 播放和 Songloft 歌单导入能力。

## 明确边界

- 采用方案 A: 基于 MIoT 插件扩展。MIoT 插件作为主干，新增独立 LX 音乐域和播放桥接域。
- 不预置任何默认音源。
- `C:\Users\18888\Downloads\LX Music(含魔改版及音源) v26.6.20\LX音源大全(含无损音源及部分音源历史版本)\『直接可用的音源』\星海音乐源 v2.3.5.js` 只作为验收测试时的用户导入音源，不打包、不内置、不默认启用。
- `J:\lx-music-source-paid-1782020522186.js` 是付费音源，设计和实现均不得读取、复制、打包、默认配置或用于测试。
- 该设计文档只定义实现目标和验收边界，不在本阶段创建插件工程或实现代码。

## 参考资料

- Songloft JS 插件开发文档: `J:\plugins\js-plugin-development-guide.md`
- MIoT 插件: `J:\plugins\songloft-plugin-miot`
- LX Music Songloft 插件: `J:\plugins\lxmusic.jsplugin`
- LX server: `J:\plugins\lxserver`
- Songloft 测试环境: `http://192.168.31.63:18191/`
- 测试账号: 用户提供的本地测试账号 `admin/admin`

重要代码参考:

- `J:\plugins\songloft-plugin-miot\src\main.ts`
- `J:\plugins\songloft-plugin-miot\src\types.ts`
- `J:\plugins\songloft-plugin-miot\src\config\manager.ts`
- `J:\plugins\songloft-plugin-miot\src\voicecmd\engine.ts`
- `J:\plugins\songloft-plugin-miot\static\index.html`
- `J:\plugins\songloft-plugin-miot\static\css\style.css`
- `J:\plugins\lxmusic.jsplugin\main.js`
- `J:\plugins\lxmusic.jsplugin\plugin.json`
- `J:\plugins\lxmusic.jsplugin\static\index.html`
- `J:\plugins\lxmusic.jsplugin\static\js\app.bundle.fc8e35e1.js`
- `J:\plugins\lxserver\src\server\userApi.ts`
- `J:\plugins\lxserver\src\server\customSourceHandlers.ts`
- `J:\plugins\lxserver\src\server\server.ts`
- `J:\plugins\lxserver\src\modules\utils\musicSdk\index.js`

## Songloft 运行时约束

插件运行在 Songloft JS 插件运行时中，核心约束如下:

- 使用 QuickJS actor 生命周期: `onInit`、`onDeinit`、`onHTTPRequest`。
- 静态 UI 通过 `/api/v1/jsplugin/<entryPath>/` 暴露。
- 运行时会注入 `common.css`、`common.js`、认证桥接和主题变量。
- `fetch` 和定时器可用；插件退出时必须清理监听、定时器、运行锁和后台任务。
- 需要保留并声明权限: `storage`、`songs.read`、`songs.write`、`playlists.read`、`playlists.write`、`inter-plugin`、`command`、`jsenv`。
- LX 自定义音源执行依赖 `jsenv` 权限。所有用户导入脚本必须通过隔离适配层调用，不直接暴露给前端。

## 架构

新插件分为五个域:

1. `miot` 域
   - 从 `songloft-plugin-miot` 移植账号、设备、Mina 播放、配置、对话监听、语音口令、索引、定时任务等能力。
   - 优先保持原有 API 行为和数据结构，降低迁移风险。

2. `music` 域
   - 从 `lxmusic.jsplugin`、`lxserver` 抽取音源管理、平台 SDK、搜索、歌单、榜单、歌词和 URL 解析能力。
   - 内置支持平台能力选择: 酷我、酷狗、QQ 音乐、咪咕、网易云。
   - 用户可导入 LX 音源 `js` 或 `zip` 包，插件保存导入记录和启用状态。

3. `bridge` 域
   - 负责把 LX 结果转换为 Songloft 可导入歌曲、Web 可试听 URL、音箱 URL 播放请求和语音外部搜索结果。
   - 负责将搜索结果写入 Songloft 歌单，或直接推送到已选择智能音箱。

4. `ui` 域
   - 提供 iOS 27 风格的插件 Web UI。
   - 页面只调用插件自身 HTTP API，不直接访问第三方接口或 Songloft 内部实现。

5. `system` 域
   - 管理结构化错误、日志脱敏、运行锁、缓存、配置迁移、任务生命周期和健康状态。

建议目录结构:

```text
songloft-plugin-starlight/
  plugin.json
  package.json
  tsconfig.json
  src/
    main.ts
    router/
    miot/
    music/
    bridge/
    config/
    storage/
    system/
    types/
  static/
    index.html
    css/
    js/
  tests/
```

## 功能设计

### 米家账号登录

必须支持三种登录方式:

- 扫码登录。
- 账号密码登录。
- 手动 Token 登录。

扫码登录验收时需要真人协助扫码，测试用例应把扫码动作标记为人工步骤。登录成功后保存账号状态，支持状态检测、重新登录、Token 过期提示和多账号切换。

### 智能音箱控制

完整保留 MIoT 插件所有音箱能力:

- 音频格式转换。
- 指示灯开关。
- 自定义 Music API 型号。
- 对话监听。
- 歌曲索引。
- 搜索提示开关。
- URL 播放。
- 时区设置。
- 定时任务。

语音口令全部依赖对话监听。若未开启对话监听，UI 应禁用或提示相关语音口令功能。

语音口令清单:

- 播放歌单，支持自定义口令词。
- 播放歌曲，支持自定义口令词。
- 随机播放，支持自定义口令词。
- 顺序播放，支持自定义口令词。
- 单曲循环，支持自定义口令词。
- 列表循环，支持自定义口令词。
- 音量控制: 绝对音量，支持自定义口令词。
- 音量控制: 增加音量，支持自定义口令词。
- 音量控制: 减小音量，支持自定义口令词。
- 歌曲控制: 上一首，支持自定义口令词。
- 歌曲控制: 下一首，支持自定义口令词。
- 歌曲控制: 停止播放，支持自定义口令词。
- AI 口令分析，支持自定义 API 地址。启用后优先使用 AI 分析，规则口令不再生效。
- 外部搜索。启用后，本地歌曲搜索未命中时调用 LX 音乐搜索和 URL 解析链路。

### LX 音源与 Web 音乐能力

音源设置必须支持:

- 导入 LX 音源 `js` 文件。
- 导入 LX 音源 `zip` 包。
- 音源列表、启用、停用、删除、能力检测和错误显示。
- 平台选择: 酷我、酷狗、QQ 音乐、咪咕、网易云。
- 无默认音源。首次进入音源页时显示空状态和导入入口。

歌曲搜索:

- 用户可输入歌曲名或歌手名搜索。
- 可选择音源平台。
- 搜索结果展示歌曲名、歌手、专辑、时长、来源、音质或 URL 可用状态。
- 支持 Web 试听、复制 URL、导入 Songloft 歌单、推送到当前音箱播放。

歌单能力:

- 歌单搜索。
- 推荐歌单。
- 热门歌曲排行榜。
- 歌单解析。
- 可将歌单解析结果批量导入 Songloft 歌单。

星海音乐源测试注意:

- `星海音乐源 v2.3.5.js` 支持 `musicUrl`。
- 该音源代码中包含 `wy`、`tx`、`kw`、`kg`、`mg` 平台。
- 若 LX 兼容层使用 `env: "desktop"`，该音源可能过滤 `mg`。验收时如咪咕不可用，应先记录为音源兼容层行为，不判定为 Starlight 功能失败。
- 该音源仅用于人工导入测试，不能出现在 `plugin.json`、默认配置、初始化脚本或发布包中。

## UI 与信息架构

整体风格参考 iOS 27，落实为 Songloft 插件内的实用 Web UI:

- 内容优先，避免营销式落地页。
- 使用 Songloft 注入主题变量。
- 可加入轻量 glass surface: 半透明、模糊、1px 高亮边；不使用强渐变背景、装饰光球或大面积单色主题。
- 页面标题左对齐。
- 图标按钮优先使用 Material Symbols 或现有图标库；明确命令保留文字。
- 卡片圆角控制在工具界面可接受范围内，避免卡片套卡片。
- 所有控件需在桌面和移动端避免文字溢出、按钮挤压和内容重叠。

主导航:

- 搜索。
- 音箱。
- 歌单。
- 排行榜。
- 音源。
- 自动化。
- 设置。

布局:

- 桌面端使用左侧导航 rail，主内容区右侧可出现状态面板。
- 移动端使用底部 Tab。
- 顶部显示当前设备、登录态、音源状态和关键健康状态。
- 底部 mini player 或音箱控制条用于显示当前播放、音量和播放模式。
- 设置页拆分为账号、设备、语音口令、AI、外部搜索、索引、时区、日志等分组，避免把所有 MIoT 配置堆在单页长表单。

核心工作流:

1. 用户导入星海测试源或其他自有音源。
2. 用户启用音源并选择平台。
3. 用户搜索歌曲或歌单。
4. 用户试听、导入 Songloft 歌单或推送音箱 URL 播放。
5. 用户登录米家并选择设备。
6. 用户开启对话监听并配置语音口令。
7. 本地索引命中时播放本地歌曲；未命中且外部搜索开启时调用 LX 搜索。
8. 定时任务按设备或所有受管理设备执行播放、停止、音量和监听开关等动作。

## HTTP API 设计

前端统一调用 `/api/v1/jsplugin/starlight/api/*`。所有响应使用统一 envelope:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

失败响应:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "SOURCE_IMPORT_INVALID",
    "message": "音源文件无效",
    "retryable": false,
    "details": {}
  }
}
```

### `miot` API

保留并迁移 MIoT 插件现有能力，建议统一挂载:

- `GET /api/miot/accounts`
- `POST /api/miot/account`
- `POST /api/miot/auth/login`
- `POST /api/miot/auth/captcha`
- `POST /api/miot/auth/verify`
- `POST /api/miot/auth/token`
- `GET /api/miot/auth/status`
- `POST /api/miot/auth/qrcode`
- `GET /api/miot/auth/qrcode/poll`
- `POST /api/miot/auth/relogin`
- `GET /api/miot/mina/devices`
- `POST /api/miot/mina/volume`
- `POST /api/miot/mina/play-url`
- `POST /api/miot/mina/pause`
- `POST /api/miot/mina/resume`
- `POST /api/miot/mina/device/managed`
- `GET /api/miot/mina/last-selection`
- `GET /api/miot/playlists`
- `GET /api/miot/playlists/:id/songs`
- `POST /api/miot/player/play`
- `POST /api/miot/player/stop`
- `POST /api/miot/player/toggle`
- `POST /api/miot/player/previous`
- `POST /api/miot/player/next`
- `POST /api/miot/player/mode`
- `GET /api/miot/player/status`
- `GET /api/miot/config`
- `PUT /api/miot/config`
- `GET /api/miot/conversation/messages`
- `GET /api/miot/conversation/status`
- `GET /api/miot/conversation/webhooks`
- `GET /api/miot/schedules`
- `POST /api/miot/schedules/update`
- `POST /api/miot/schedules/toggle`
- `GET /api/miot/schedules/logs`
- `GET /api/miot/voice-commands`
- `PUT /api/miot/voice-commands`
- `POST /api/miot/voice-commands/ai-test`
- `GET /api/miot/indexing/status`
- `POST /api/miot/indexing/refresh`

### `music` API

新增或迁移 LX 能力:

- `GET /api/music/platforms`
- `GET /api/music/sources`
- `POST /api/music/sources/import`
- `POST /api/music/sources/import-url`
- `POST /api/music/sources/toggle`
- `DELETE /api/music/sources/:id`
- `POST /api/music/search`
- `GET /api/music/songlist/sorts`
- `GET /api/music/songlist/tags`
- `GET /api/music/songlist/list`
- `POST /api/music/songlist/search`
- `GET /api/music/songlist/detail`
- `GET /api/music/leaderboard/boards`
- `GET /api/music/leaderboard/list`
- `POST /api/music/url`
- `POST /api/music/lyric`

### `bridge` API

桥接 Songloft 和音箱:

- `POST /api/bridge/songs/import`
- `POST /api/bridge/songlist/import`
- `POST /api/bridge/play-url`
- `POST /api/bridge/preview-url`
- `POST /api/bridge/external-search`
- `POST /api/bridge/voice-play`

### `health` API

用于 UI 状态汇总:

- `GET /api/health/summary`
- `GET /api/health/logs`
- `POST /api/health/logs/clear`

## 数据模型

核心持久化键建议按域隔离:

- `starlight:miot:accounts`
- `starlight:miot:selectedAccount`
- `starlight:miot:selectedDevice`
- `starlight:miot:config`
- `starlight:miot:voiceCommands`
- `starlight:miot:schedules`
- `starlight:music:sources`
- `starlight:music:sourceBundles`
- `starlight:music:platformPreference`
- `starlight:music:cache`
- `starlight:system:migrations`
- `starlight:system:logs`

数据边界:

- 米家账号密码、Token、AI API Key 只保存在插件存储中。
- UI 只显示脱敏后的 Token 或 Key。
- 日志不得输出账号密码、Token、API Key、完整 Cookie 或音源私密配置。
- 音源导入包保存用户上传内容和解析后的能力摘要；默认配置为空。
- 搜索缓存可清理，可设置 TTL，不能影响音源启用状态。

## 错误处理和运行安全

统一错误码至少覆盖:

- `AUTH_QR_EXPIRED`
- `AUTH_PASSWORD_FAILED`
- `AUTH_TOKEN_EXPIRED`
- `DEVICE_OFFLINE`
- `DEVICE_NOT_SELECTED`
- `PLAY_URL_RESOLVE_FAILED`
- `AUDIO_CONVERT_FAILED`
- `SOURCE_IMPORT_INVALID`
- `SOURCE_RUNTIME_FAILED`
- `SOURCE_NOT_ENABLED`
- `MUSIC_SEARCH_EMPTY`
- `MUSIC_PLATFORM_UNSUPPORTED`
- `VOICE_LISTENER_DISABLED`
- `VOICE_AI_FAILED`
- `EXTERNAL_SEARCH_DISABLED`
- `INDEX_REFRESH_RUNNING`
- `SCHEDULE_LOCKED`

运行锁:

- 对话监听只能有一个活动监听循环。
- 索引刷新同一时间只能运行一个任务。
- 定时任务调度器在插件重载后必须避免重复注册。
- 音源导入和 zip 解包需要互斥，避免覆盖同一个音源记录。

外部接口边界:

- AI 口令分析默认关闭。启用后优先于规则口令。
- 外部搜索默认关闭。开启后只在本地索引未命中时调用。
- 搜索提示开关只影响语音搜歌期间是否播报提示，不改变搜索逻辑。

## 验收测试

### 本地模块测试

- MIoT 登录状态、设备选择、播放控制、语音口令、定时任务迁移后行为一致。
- LX 音源导入、平台列表、启用状态、搜索参数、歌单解析、榜单解析、URL 解析有模块测试。
- Bridge 转换测试覆盖 LX 搜索结果到 Songloft song、playlist item、speaker play URL 的转换。
- 配置迁移、脱敏日志、运行锁和错误码映射有独立测试。

### Songloft 插件集成测试

测试环境为 `http://192.168.31.63:18191/`，使用用户提供的本地测试账号。

验收项:

- 插件可安装，`entryPath` 为 `starlight`。
- `/api/v1/jsplugin/starlight/` 静态 UI 可打开。
- `onInit` 初始化存储、配置和调度器。
- `onHTTPRequest` 覆盖所有 UI 所需 API。
- `onDeinit` 清理监听、定时器和运行锁。
- 首次进入音源页没有默认音源。
- 导入 `星海音乐源 v2.3.5.js` 后，用户可手动启用并进行搜索或 URL 解析测试。
- 付费音源文件未被读取、未出现在发布包、未出现在默认配置、未出现在日志。

### 端到端验收

米家登录:

- 扫码登录: 人工扫码协助完成，验证二维码生成、轮询、过期提示和登录成功状态。
- 账密登录: 验证成功、验证码或失败提示。
- 手动 Token: 验证保存、状态检测和过期提示。

音箱控制:

- 获取设备列表。
- 选择当前设备。
- 音量绝对设置、增加、减小。
- 上一首、下一首、暂停、继续、停止。
- 播放模式切换: 随机、顺序、单曲循环、列表循环。
- 指示灯开关。
- URL 播放。
- 时区设置。
- 自定义 Music API 型号。
- 音频格式转换。

语音:

- 开启对话监听后规则口令可触发播放歌单、播放歌曲、播放控制和音量控制。
- 未开启对话监听时语音口令不可用并有明确提示。
- AI 口令分析开启后优先于规则口令。
- 外部搜索开启后，本地索引未命中时调用 LX 搜索；关闭时不调用。
- 搜索提示开关开启时，语音搜歌期间有简短提示；关闭时不播报提示。

音乐 Web:

- 歌曲搜索支持歌曲名和歌手名。
- 平台选择覆盖酷我、酷狗、QQ 音乐、咪咕、网易云；若测试音源对某平台不支持，UI 显示为音源能力限制。
- 搜索结果可试听、导入 Songloft 歌单、推送当前音箱播放。
- 歌单搜索、推荐歌单、热门排行榜、歌单解析可用。
- 歌单解析结果可批量导入。

UI:

- 桌面端左侧导航、顶部状态、底部 mini player 或音箱控制条布局正常。
- 移动端底部 Tab、搜索页、音源页、音箱页、自动化页无文字溢出和控件重叠。
- 明暗主题跟随 Songloft 主题变量。

## 实现顺序建议

1. 复制并重命名 MIoT 插件骨架，改 `plugin.json`、`entryPath` 和命名空间。
2. 保留 MIoT 功能测试基线，先确保原智能音箱能力在新插件中工作。
3. 新增 `music` 域，移植 LX 平台 SDK、音源导入和 URL 解析适配层。
4. 新增 `bridge` 域，完成搜索结果到 Songloft 歌单和音箱播放的转换。
5. 重建 UI 信息架构，先完成搜索、音箱、音源三个核心页。
6. 接入歌单、排行榜、自动化、设置和健康日志。
7. 做端到端验收，优先验证扫码登录、测试音源导入、搜索到音箱播放的主链路。

## 非目标

- 不开发新的音乐源协议。
- 不绕过第三方平台限制。
- 不内置、共享或默认启用任何付费音源。
- 不把 Songloft 服务端能力改造成插件外服务。
- 不在本阶段实现插件代码；实现计划需在用户审阅本设计后另行生成。
