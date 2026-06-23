# Starlight 实施进度

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
