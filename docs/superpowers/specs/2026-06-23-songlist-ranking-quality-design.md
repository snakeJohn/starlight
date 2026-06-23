# 歌单和排行音质选择设计

## 目标

在歌单页和排行页顶部增加音质下拉框，默认 `flac24bit`，并让歌单详情、排行榜歌曲加载以及后续下载都使用用户选择的音质。

## 方案

- 歌单页搜索表单增加 `quality` 字段，默认 `flac24bit`。
- 排行页加载控件增加 `ranking-quality` 下拉框，默认 `flac24bit`。
- 前端在歌单搜索/推荐、歌单详情、排行榜加载和翻页时保存并传递当前音质。
- 后端 `/api/music/songlist/detail` 和 `/api/music/leaderboard/list` 接收 `quality` 查询参数，并复用现有 `applyRequestedQuality` 归一化返回歌曲的 `source_data.quality`。
- 下载入口保持不变，继续读取歌曲对象里的 `source_data.quality`，因此列表歌曲音质会自然影响单曲和整单下载。

## 测试

- 静态 UI 测试覆盖歌单和排行音质下拉框的存在、默认值和顺序。
- 前端静态测试覆盖歌单详情和排行歌曲请求会带 `quality`。
- 后端 handler 测试覆盖歌单详情和排行榜歌曲返回值会应用请求音质。
