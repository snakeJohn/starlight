# Starlight 实施发现记录

## 2026-06-23 项目级审查

- 当前目标已切换为项目级代码审查、冗余删除和缺陷修复。
- 本地播放器已在提交 `acc29c5` 删除：`static/js/plugin_player.js`、`static/js/native_player.js`、`tests/ui/plugin_player.test.ts` 已不存在。
- 插件目录当前工作树干净；父工作树仍存在未跟踪文件 `../README.md`、`../Typora_Hook_Log.txt`，继续不触碰。
- 旧实施计划中“本插件全局播放控件完成”的验收项已经过时，新的验收以“不保留本地播放器残留”为准。
- 本地播放器残留扫描：`plugin-player`、`native-player`、`native_player`、`local-player`、`localPlayer`、`data-role="plugin-player"`、`data-role="global-player"`、`data-action="global-player"` 仅命中 UI 断言，不命中运行时代码。
- 可见播放按钮扫描：`>播放</button>`、`>试听<` 未命中运行时静态文件；用户随后要求删除所有可见播放控件，`speaker-player-*` 音箱控制面板也已移除，后续只保留“推送音箱”入口和后端/语音播放能力。
- 严格 unused 扫描根因：多个 handler 注册函数保留了历史依赖参数，部分 GET 路由保留未使用 `req`，`PlaylistManager` 保留未读取的 `totalSongs` 字段，`mina/auth.ts` 和测试中存在历史 helper/type import 残留。
- 严格 unused 清理策略：删除只读证据为零的 import/helper/字段；对仍被调用的函数签名同步收窄调用点；保留路由 SDK 需要占位的 path params 回调首参并改为 `_req`。
- 前端死代码扫描发现：`automation-player-*` 已不在 `static/index.html` 中，但 `static/js/automation.js` 仍保留旧自动化播放控件逻辑和 `tests/ui/automation_player.test.ts`；`speaker.js` 仍监听已隐藏的账密登录、Token 登录、旧音量表单和 URL 播放表单。
- 前端死代码处理：用静态布局测试先复现旧 selector 残留，再删除自动化旧播放控件、隐藏登录/旧表单事件绑定和过时测试文件。当前 `automation-player`、`password-login-form`、`token-login-form`、`volume-form`、`url-play-form` 仅剩测试断言。
- 前端 explorer 补充发现：`static/js/state.js` 的 `selectedSong` 只有定义处命中，是本地播放器移除后的残留状态字段；已用静态测试复现并删除。
- 后端安全审查发现：`src/mina/auth.ts` 曾输出 `ssecurity`、`clientSign` 和带签名的 STS URL，这些是登录签名材料；已删除对应调试日志，并增加 logger 回归测试防止重新引入。
- 后端 explorer 发现 6 项：定时任务 `playlist_id` 被 handler 接受但 executor 不执行；`enable_monitor`/`disable_monitor` 类型和 executor 存在但 handler 拒绝；音量输入缺少 finite 校验；播放器接口未校验 `play_mode`/`start_index`；空语音“播放歌曲/歌单”实际调用 `next()`；调度时间/日期范围校验不足。
- 定时任务根因确认：`src/handlers/schedule.ts` 的 `validateTaskParams` 没有接受 `enable_monitor`/`disable_monitor`，`validateTaskTarget` 对全局动作仍要求设备；`validateSchedule` 只校验 `HH:MM` 形状不校验范围；`set_volume` 会接受字符串等非数值；`set_play_mode` 只校验非空。`src/schedule/executor.ts` 则在 `playlist_id` 存在时仍先要求 `playlist_name`。
- 定时任务修复：新增 `src/player/modes.ts` 统一校验播放模式；定时任务 handler 接受全局监听动作并给默认全局 target，严格校验时间/星期/月日/音量/播放模式；executor 支持按 `playlist_id` 直接播放，并对音量/播放模式做运行时防御。
- 播放接口根因确认：`src/handlers/playlist.ts` 的 `/player/play`、`/player/mode` 和 `src/handlers/songloft_library.ts` 的 Songloft 曲库单曲推送都会接受未知 `play_mode`；`/player/play` 还会把负数 `start_index` 传入播放管理器。已统一使用 `src/player/modes.ts` 校验，并让 Songloft 曲库 BAD_REQUEST 返回 400。
- 语音口令根因确认：`src/voicecmd/engine.ts` 中 `executePlayPlaylist` 和 `executePlaySong` 的空参数分支注释为“恢复播放”，实际调用 `pm.next()`，导致用户只说“播放歌单/播放歌曲”时误切下一首。已改为已有队列时保持当前播放，未播放时调用 `resumePlayback()`。
- 前端 explorer 结果：未发现本地播放器运行时残留；仍有 `static/js/automation.js` 对已隐藏设置字段和 `data-role="host-url"` 的死代码；`static/css/style.css` 的 `.voice-record-list minmax(280px, 1fr)` 在 320px 移动端有溢出风险，底部 tab 固定栏未与 safe-area 高度共用变量，可能遮挡内容。
- 前端 explorer 修复：`static/js/automation.js` 只加载/保存当前可见的四个设置项；移除隐藏设置字段、AI 配置和 `host-url` 死代码。`static/css/style.css` 增加 `--bottom-tabs-height`，移动端内容 padding 与底部栏高度共用变量；语音记录栅格改为 `minmax(min(100%, 280px), 1fr)`。
- 设备音量根因确认：`src/handlers/device.ts` 对 `/mina/volume` 仅做空值判断，随后 `Number(volume)`，字符串会变成 `NaN` 并继续调用服务；`src/service/service.ts` 也没有二次校验，可能把 `NaN` 或越界值传给 Mina client 并写入本地配置。
- 设备音量修复：新增 `src/utils/volume.ts`，handler 解析并拒绝非有限数值或 0-100 外音量；`MinaService.setVolume` 做防御性校验，非法值直接返回 `false`，不调用设备客户端、不写本地配置。
- 本轮前端复查确认 `static/index.html` 仍有可见 `speaker-player-*` 音箱播放面板，`static/js/speaker.js` 仍有对应状态刷新、上一首/下一首/暂停/停止/模式绑定，`static/js/state.js` 仍有 `playbackState` 残留。已删除面板、绑定、CSS 和状态字段；`playbackState` 不再由推送音箱动作写入。
- 发布 explorer 只读发现：版本拆分策略合理，但 GitHub Actions release tag/asset 与 `plugin.json.download_url` 不一致，且根 `plugin.json` 的 `entryHash`/`zipHash` 发布前需要和构建产物同步。已新增 `scripts/sync-release-manifest.mjs` 和 release workflow 测试：workflow 现在先运行 `version:stamp`，构建后同步根 manifest hash，复制 `dist/starlight-${releaseVersion}.zip`，用 `releaseVersion` 作为 GitHub release tag 和 asset 名。

## 2026-06-23

- 设计文档路径：`docs/superpowers/specs/2026-06-23-starlight-library-playback-registry-design.md`。
- 当前分支：`starlight-implementation`，当前分支相对远端领先设计文档提交。
- 工作区存在插件目录外未跟踪文件：`../README.md`、`../Typora_Hook_Log.txt`，本任务不触碰。
- UI 主要文件：`static/js/music.js`、`static/index.html`、`static/css/style.css`。
- 搜索、歌单详情、排行详情分页大小在 `static/js/music.js` 的 `pageSizes` 中，目前分别为 30、30、50、50、50。
- 自建歌单详情已经有复选框和分页，但当前页大小是 50，滚动容器尚未统一。
- 搜索歌曲行由 `renderSongRow()` 生成，已有 `播放`、`导入 Songloft 歌曲库`、`下载`、`音箱`、`加入歌单`。
- 现有 CSS 已有 `.list-stack`、`.song-row`、`.pagination-bar` 和移动端媒体查询，可在此基础上加滚动列表和批量工具条。
- Songloft Swagger 路径包括 `/songs`、`/playlists`、`/playlists/{id}/songs`、`/songs/{id}/play`；插件内部应封装后给前端调用。
- 现有 MIoT 播放管理器 `PlaylistManager` 已支持 standalone queue、动态歌单和动态歌曲解析。
