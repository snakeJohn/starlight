# Starlight 实施发现记录

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
