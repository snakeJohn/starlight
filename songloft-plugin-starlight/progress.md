# Starlight 实施进度

## 2026-06-23 项目级审查

- 恢复规划文件并确认旧计划已经与当前目标不一致：本地播放器已删除，需建立新的项目级审查计划。
- 当前分支最新提交为 `acc29c5 refactor: remove local player controls`；插件目录无未提交变更，父目录未跟踪文件继续忽略。
- 已重写 `task_plan.md` 为项目级 review / 冗余清理 / 缺陷修复计划。
- 复核用户要求“移除本地播放器、删除可见播放按钮”：确认最新提交已删除本地播放器 JS/CSS/UI 和相关测试；运行 `rg` 扫描后仅剩音箱控制、语音口令、播放管理器等非本地播放器路径。
- 工具错误记录：一次 PowerShell 正则扫描因双引号和管道符解析失败，已改用单引号重新执行并取得有效结果。
- 验证命令：`npm test -- tests/ui/static_layout.test.ts tests/ui/music_rendering.test.ts tests/ui/custom_playlists.test.ts`，结果 3 个测试文件、40 个测试全部通过。
- RED：`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` 失败，暴露未使用 import、参数、字段、helper。
- 清理：收窄 `registerAccountHandlers`、`registerAuthHandlers`、`registerPlaylistHandlers` 和 `TaskExecutor` 构造函数参数；删除未使用 helper/type/字段；同步更新 `src/main.ts` 与 `tests/player/host_autodetect.test.ts`。
- GREEN：同一严格 TypeScript 命令重跑通过。
- 常规验证：`npm run typecheck` 通过；`npm test -- tests/player/host_autodetect.test.ts tests/music/runtime.test.ts tests/ui/static_layout.test.ts tests/ui/music_rendering.test.ts tests/ui/custom_playlists.test.ts` 通过，5 个测试文件、73 个测试全部通过。
- RED：新增 `tests/ui/static_layout.test.ts` 断言，要求隐藏/移走的旧控件 selector 不再残留在 JS 中；测试先失败于 `password-login-form`。
- 清理：删除 `static/js/automation.js` 中已无挂载点的 `automation-player-*` 逻辑，删除过时的 `tests/ui/automation_player.test.ts`，删除 `static/js/speaker.js` 中隐藏账密/Token 登录、旧音量表单、旧 URL 播放表单监听。
- GREEN：`npm test -- tests/ui/static_layout.test.ts tests/ui/speaker_controls.test.ts tests/ui/settings_config.test.ts tests/ui/voice_command_editor.test.ts` 通过，4 个测试文件、35 个测试全部通过；`npm run typecheck` 通过。
- RED/GREEN：为 `state.selectedSong` 残留增加静态测试，先失败后删除字段；`npm test -- tests/ui/static_layout.test.ts` 通过，22 个测试通过。
- RED/GREEN：为 Mina 认证日志增加敏感字段回归测试，先失败于 `ssecurity/clientSign/STS request URL` 日志，删除敏感调试输出后 `npm test -- tests/system/logger.test.ts` 通过，6 个测试通过；`npm run typecheck` 通过。
- 自动化验证：`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过；`npm test` 通过，45 个测试文件、258 个测试全部通过。
- RED：新增 `tests/schedule/handlers.test.ts` 和 `tests/schedule/executor.test.ts`，复现定时任务全局监听动作被拒、时间/星期/月日范围校验缺失、播放模式/音量校验缺失、`playlist_id` 执行失败。`npm test -- tests/schedule/handlers.test.ts tests/schedule/executor.test.ts` 失败 4 项。
- GREEN：新增 `src/player/modes.ts`，修复 `src/handlers/schedule.ts` 和 `src/schedule/executor.ts`。同一命令重跑通过，2 个测试文件、4 个测试全部通过。
- RED：扩展 `tests/player/host_autodetect.test.ts` 和 `tests/handlers/songloft_library.test.ts`，复现播放器 handler 接受无效 `play_mode`、负数 `start_index`，Songloft 曲库推送接受无效 `play_mode`。`npm test -- tests/player/host_autodetect.test.ts tests/handlers/songloft_library.test.ts` 失败 2 项。
- GREEN：`src/handlers/playlist.ts` 和 `src/handlers/songloft_library.ts` 接入播放模式校验与 `start_index` 校验，并让 Songloft 曲库 BAD_REQUEST 返回 400。同一命令重跑通过，2 个测试文件、9 个测试全部通过。
- RED：新增 `tests/voicecmd/empty_playback.test.ts`，复现“播放歌曲/播放歌单”空参数且已有队列时误调用 `next()`。`npm test -- tests/voicecmd/empty_playback.test.ts` 失败 2 项。
- GREEN：修复 `src/voicecmd/engine.ts` 空参数分支，已有队列时保持/恢复当前播放而不是下一首。同一命令重跑通过，1 个测试文件、2 个测试全部通过。
- 收到前端 explorer 只读结果：确认本地播放器无运行时残留，新增待处理清理项为 `automation.js` 隐藏字段残留和移动端 CSS 两处布局风险。
- RED：扩展 `tests/ui/static_layout.test.ts`，复现 `automation.js` 仍包含隐藏设置字段/host-url 代码，CSS 未定义底部栏 safe-area 共享高度且语音记录网格有 280px 固定下限。`npm test -- tests/ui/static_layout.test.ts` 失败 2 项。
- GREEN：清理 `static/js/automation.js` 隐藏设置字段加载/保存路径，修复 `static/css/style.css` 移动端底部栏和语音记录网格。`npm test -- tests/ui/static_layout.test.ts tests/ui/settings_config.test.ts` 通过，2 个测试文件、30 个测试全部通过。
- 验证：`npm run typecheck` 通过；`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过；本地播放器/API 残留扫描仅命中 `selectedSongs` 批量选择变量和测试断言。
- 验证：`npm test` 通过，48 个测试文件、268 个测试全部通过；`npm run build` 成功；`npm run validate` 成功。
- RED：扩展 `tests/handlers/device.test.ts` 并新增 `tests/service/service.test.ts`，复现 `/mina/volume` 接受非数值音量、`MinaService.setVolume` 直接向客户端传递 `NaN`/越界值。`npm test -- tests/handlers/device.test.ts tests/service/service.test.ts` 失败 2 项。
- GREEN：新增 `src/utils/volume.ts`，修复 `src/handlers/device.ts` 和 `src/service/service.ts`。`npm test -- tests/handlers/device.test.ts tests/service/service.test.ts tests/schedule/executor.test.ts` 通过，3 个测试文件、4 个测试全部通过。
- 收到用户追加要求：移除本地播放器，所有可见播放按钮也删除。复查确认 `static/index.html` 仍有可见 `speaker-player-*` 音箱播放控制面板，`static/js/speaker.js` 仍有对应事件绑定和状态刷新，`static/js/state.js` 仍有 `playbackState` 残留。
- RED：扩展 `tests/ui/static_layout.test.ts`，要求不再渲染 `speaker-player-*` 控件、不再保留 `speaker-player` JS/CSS 和 `playbackState`。测试先失败于 `speaker-player-panel` 和 `playbackState`。
- GREEN：删除音箱页可见播放控制面板、相关 CSS、`speaker.js` 播放控件绑定/状态刷新导出、`state.playbackState` 以及推送音箱动作里的本地播放状态写入；同步删除 `tests/ui/speaker_controls.test.ts` 中旧播放控件测试。
- 定向验证：`npm test -- tests/ui/static_layout.test.ts tests/ui/speaker_controls.test.ts tests/ui/music_rendering.test.ts tests/ui/custom_playlists.test.ts` 通过，4 个测试文件、48 个测试全部通过；残留扫描不再命中运行时 `speaker-player`、`global-player`、`plugin_player`、`playbackState`。
- 全量验证：`npm run typecheck` 通过；`git diff --check` 无 whitespace error（仅 Windows 换行提示）；`npm test` 通过，49 个测试文件、268 个测试全部通过；`npm run build` 成功；`npm run validate` 成功。
- 收到发布 explorer 只读结果：`plugin.json`/版本测试的 `V-yyyy.mm.dd.hh.mm` release metadata 策略合理，但 `.github/workflows/release.yml` 的 tag/asset 与 `plugin.json.download_url` 预期不一致，发布前需单独修复并同步 root manifest hash。
- RED：新增 `tests/release/manifest_sync.test.ts` 并扩展 `tests/release/registry.test.ts`，复现缺少 manifest 同步脚本、workflow 未运行 `version:stamp`、仍使用 `starlight-${github.sha}` tag 和原始 zip 路径。`npm test -- tests/release/manifest_sync.test.ts tests/release/registry.test.ts tests/release/version.test.ts` 失败 2 项。
- GREEN：新增 `scripts/sync-release-manifest.mjs`，替换不可靠的 `publish:release` 脚本为 `release:manifest`；修复 `.github/workflows/release.yml`，push 后自动打 `V-yyyy.mm.dd.hh.mm` 版本、同步 `entryHash`/`zipHash`、提交 release metadata、上传 `starlight-${releaseVersion}.zip` 并用 `releaseVersion` 打 tag。同一 release 测试通过，3 个测试文件、7 个测试全部通过。
- 真实构建同步：`npm run build` 后执行 `npm run release:manifest`，根 `plugin.json` 更新为 `entryHash=167e2c2c...`、`zipHash=a633cc71...`，`dist/starlight-V-2026.06.23.13.13.zip` 存在。
- 最终验证：`npm run typecheck` 通过；`npm test` 通过，50 个测试文件、270 个测试全部通过；`npm run build` 通过；`npm run release:manifest` 通过；`npm run validate` 通过；`git diff --check` 无 whitespace error（仅 Windows 换行提示）。

## 2026-06-23

- 创建持久化计划文件：`task_plan.md`、`findings.md`、`progress.md`。
- 准备根据设计文档进入阶段 1：UI 列表机制。
- 采用多 agent 执行策略：主线程负责 UI 阶段，worker 负责 Songloft 后端接口与发布版本自动化，避免写入同一批文件。
- UI 阶段 RED：运行 npm test -- tests/ui/music_pagination.test.ts tests/ui/music_rendering.test.ts tests/ui/static_layout.test.ts tests/ui/custom_playlists.test.ts，6 个失败均对应缺失的 20 条分页、复选框、滚动容器和批量工具条。
- UI 阶段 GREEN：搜索、歌单、排行、自建歌单详情统一 20 条分页，搜索增加清空、复选框和批量操作，长列表加入滚动容器；同一批 UI 测试 39 个全部通过。
- Songloft 数据接入扩展：新增 Songloft 曲库前端控件、Songloft 歌曲音箱播放接口 `/api/songloft/player/song`，相关 handler/UI/static layout 测试 27 个全部通过。
- 语音口令扩展：自建歌单优先，随后匹配 Songloft 歌单、Songloft 曲库/本地歌曲，最后保留在线搜索兜底；`tests/voicecmd/songloft_library.test.ts`、`custom_playlists.test.ts`、`standalone_playback.test.ts` 共 8 个测试通过。
- 播放/下载换源：播放失败只在播放音源内查找替代 URL，下载失败只在下载音源内查找替代 URL；`tests/bridge/service.test.ts`、`tests/download/service.test.ts`、`tests/player/standalone_queue.test.ts` 共 37 个测试通过。
- 类型检查修复：修正 Songloft 曲库 handler 和测试类型声明；`npm run typecheck` 通过，相关 handler/release/UI 测试 21 个通过。
- 本插件全局播放控件：新增独立 `plugin-player-*` 控件和本地队列，单条 `播放` 按钮接入本插件本地播放状态，不接管 MIoT `global-player-*` 控件；相关 UI 回归和完整 `npm test` 已由 worker 跑通。
- 进入最终阶段：等待最终代码审查，随后更新实际版本戳，运行全量验证并推送 GitHub。
