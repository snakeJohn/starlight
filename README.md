# Starlight 音乐助手

Starlight 是一个 Songloft JS 插件，面向“音乐搜索、歌单整理、歌曲下载、Songloft 曲库同步、MIoT 智能音箱控制”这些连续使用场景。插件整合了 LX Music 音源能力和小米智能音箱控制能力，允许在 Songloft Web 页面里完成音源导入、搜索、歌单收藏、自建歌单、导入到 Songloft 曲库、推送到音箱、语音控制和下载等操作。

插件入口为 `starlight`，安装后页面地址通常是：

```text
http://<songloft-host>/api/v1/jsplugin/starlight/
```

## 功能概览

### 音源与搜索

- 支持导入 LX Music 音源 JavaScript 文件。
- 区分播放音源和下载音源，避免同一个音源被错误用于不适合的场景。
- 支持歌曲列表分页、封面展示、批量选择和批量导入 Songloft 歌曲库。
- 支持解析歌曲播放 URL，用于试听、导入、推送音箱和后续播放。

### 歌单与榜单

- 支持搜索歌单、推荐歌单和排行榜。
- 支持查看歌单详情和排行榜歌曲明细。
- 支持收藏外部歌单到“我的歌单”。
- 支持自建歌单，歌曲可来自不同平台。
- 支持从外部歌单导入为自建歌单。
- 支持将自建歌单同步到 Songloft 歌单。
- 支持将歌单推送到智能音箱播放。

### Songloft 曲库桥接

- 支持读取 Songloft 歌曲库、歌单、本地歌曲。
- 支持把外部搜索结果导入 Songloft 歌曲库。
- 普通导入按 Songloft 远程歌曲写入，避免使用虚拟插件入口。
- 统一规范化 Songloft host，避免 `/api/v1/api/v1/...` 这类重复路径导致导入失败。

### 下载

- 支持单曲下载和批量下载。
- 支持下载进度查询和清空。
- 支持下载设置：保存路径模板、元数据写入、下载间隔。
- 下载时可通过下载音源解析歌曲地址，并在失败时尝试候选音源。

### MIoT 智能音箱

- 支持米家账号扫码登录。
- 支持账号重新登录和删除账号。
- 支持刷新并选择小爱音箱设备。
- 支持 URL 播放、音量控制、暂停、继续、停止、上一首、下一首、播放模式切换。
- 支持对话监听和 12 小时内最近对话记录。
- 支持语音口令控制：播放歌单、播放歌曲、随机播放、顺序播放、单曲循环、列表循环、音量控制、上一首、下一首、停止播放等。
- 支持定时任务。
- 支持强制 MP3 转换等兼容设置。

## 项目结构

当前仓库根目录就是插件工程根目录：

```text
.
├── plugin.json              # Songloft 插件清单
├── package.json             # 构建、测试、发布脚本
├── registry.json            # 插件源注册表
├── scripts/                 # 版本和 release manifest 同步脚本
├── src/                     # 插件后端逻辑
├── static/                  # 插件 Web UI
├── tests/                   # Vitest 测试
└── docs/                    # 项目与接口文档
```

核心模块：

- `src/music/`：LX 音源运行时、平台搜索、歌单、榜单、URL 解析。
- `src/bridge/`：搜索结果到 Songloft 曲库、智能音箱播放的桥接逻辑。
- `src/download/`：下载音源、下载任务和下载进度。
- `src/custom_playlists/`：自建歌单和外部歌单导入。
- `src/mina/`、`src/auth/`、`src/account/`：米家账号与智能音箱接入。
- `src/player/`：音箱播放队列和播放模式管理。
- `src/voicecmd/`：语音口令解析和执行。
- `src/handlers/`：插件 HTTP API 路由。

## 安装与更新

插件清单：

```text
https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json
```

插件源：

```text
https://raw.githubusercontent.com/snakeJohn/starlight/main/registry.json
```

如果使用 Songloft 插件源功能，可将 `registry.json` 的 Raw URL 加入插件源订阅。

## 本地开发

安装依赖：

```bash
npm ci
```

类型检查：

```bash
npm run typecheck
```

运行测试：

```bash
npm test
```

构建插件：

```bash
npm run build
```

校验插件清单和构建产物：

```bash
npm run validate
```

同步 release manifest：

```bash
npm run release:manifest
```

## 版本规则

插件版本统一使用实际构建时间生成：

```text
V-yyyy.mm.dd.hh.mm
```

示例：

```text
V-2026.06.23.11.27
```

`plugin.json` 中的 `releaseVersion`、`download_url`、`entryHash`、`zipHash` 会在发布流程中自动同步。

## 使用建议

- 播放音源和下载音源建议分开导入、分开启用。
- 普通搜索结果导入 Songloft 曲库时，只保存远程歌曲信息，不预置默认音源。
- 外部歌单导入时建议保存歌曲名和作者，再在播放时按歌曲名和作者匹配可用音源，降低单个平台失效带来的影响。
- MIoT 音箱语音口令依赖对话监听，开启语音口令前需要先选择并托管音箱设备。

## 其他插件调用

Starlight 提供 HTTP API 供其他插件调用。接口路径以插件运行时路径为前缀：

```text
/api/v1/jsplugin/starlight
```

详细接口请看：

```text
docs/starlight-plugin-api.md
```
