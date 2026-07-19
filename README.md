# Starlight

Songloft JS 插件：把 **LX Music 音源 / 歌单同步**、**Songloft 曲库与歌单**、**小米智能音箱（MIoT）控制** 放在同一个 Web 界面里完成。

| | |
|---|---|
| 入口路径 | `starlight` |
| 页面地址 | `http://<songloft-host>/api/v1/jsplugin/starlight/` |
| 最低宿主 | Songloft Host ≥ 2.0.0 |
| 许可 | Apache-2.0 |
| 仓库 | https://github.com/snakeJohn/starlight |

---

## 能做什么

### 音源 · 搜索 · 播放

- 导入 LX Music 音源脚本（`.js` / 打包 zip）
- 播放音源与下载音源分开配置，避免混用
- 多平台搜索、分页、封面、批量导入 Songloft 曲库
- **多源最高音质**：按 `flac24bit → flac → 320k → 128k` 探测，哪个渠道能播就用哪个，不锁死单一平台

### 歌单 · 榜单 · 自建列表

- 搜索歌单、推荐歌单、排行榜与详情
- 收藏外部歌单到「我的歌单」
- 自建歌单（跨平台曲目）
- 同步到 Songloft 原生歌单（先入曲库，再按 `song_ids` 写入歌单）
- 推送到智能音箱播放

### 洛雪同步（本机服务端）

Starlight **自带 LX Music 同步服务**，桌面端 / 移动端可直接连本机 Songloft 插件，无需再单独部署 lxserver。

- 协议：`/hello` · `/id` · `/ah` · WebSocket `/socket`
- 设置页提供 **服务器地址** 与 **同步密钥**
- 同步成功后按同名写入 Songloft 歌单，并导入曲库
- **Songloft → 洛雪**：可将宿主歌单镜像到洛雪列表（`lx:user:songloft:*`），并推送给在线客户端
- 设置页同步状态约 **5 秒自动轮询**（在线设备数、上次同步时间）
- 封面 / 歌词 / 播放地址：联网多源解析，取最高可播音质
- 重生成密钥会轮换 `serverId`、吊销旧设备；请在洛雪里重新填写新密钥并重新启用同步

**洛雪侧配置：**

1. 打开 Starlight → 设置 → 洛雪同步  
2. 确认「启用同步服务」已勾选  
3. 复制「服务器地址」与「同步密钥」  
4. 洛雪 → 设置 → 同步服务 → 填入地址与密钥 → 启用  

手机需与运行 Songloft 的机器在同一局域网。首次双边都有数据时会弹出同步方式；之后同一设备一般自动合并、不再反复弹窗。

### Songloft 曲库桥接

- 读曲库 / 歌单 / 本地歌曲  
- 搜索结果导入为远程歌曲  
- 规范化宿主 URL，避免重复 `/api/v1` 路径  

### 下载

- 单曲 / 批量下载与进度  
- 保存路径模板、元数据、间隔  
- 下载音源失败时可换候选源  

### 小爱音箱（MIoT）

- 米家账号：扫码登录、账号密码、手动 Token；设备刷新与选择  

- URL / 队列播放：音量、暂停、切歌、播放模式  
- 对话监听与近期对话  
- 语音口令：放歌、放歌单、模式、音量、上下首、停止等  
- 定时任务、强制 MP3 等兼容选项  

---

## 安装与更新

**插件清单**

```text
https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json
```

**插件源（可整源订阅）**

```text
https://raw.githubusercontent.com/snakeJohn/starlight/main/registry.json
```

在 Songloft 中通过插件源安装，或下载 Release 中的 `starlight-*.zip` / 本地 `dist/starlight.jsplugin.zip` 手动安装。安装后建议重启或重载宿主。

---

## 本地开发

```bash
npm ci
npm run typecheck   # TypeScript
npm test            # Vitest
npm run build       # → dist/starlight.jsplugin.zip
npm run validate    # 清单与产物校验
npm run dev         # 开发模式（会先拉节假日数据）
```

发布相关：

```bash
npm run version:stamp      # 按构建时间打版本
npm run release:manifest   # 同步 plugin.json 中的 hash / download_url
```

版本号格式：`V-yyyy.mm.dd.hh.mm`（如 `V-2026.07.05.07.47`）。

---

## 仓库结构

```text
.
├── plugin.json          # 插件清单（权限、publicPaths、更新地址）
├── package.json
├── registry.json        # 插件源
├── src/                 # 后端（QuickJS / 宿主运行）
│   ├── music/           # LX 音源运行时、平台、歌词
│   ├── bridge/          # 搜索 → 曲库 / 音箱 / 最高音质
│   ├── lx_sync/         # 洛雪同步服务端（HTTP + WS）
│   ├── custom_playlists/# 自建 / 导入 / 同步 Songloft 歌单
│   ├── mina/ auth/      # 米家与音箱
│   ├── player/          # 音箱队列
│   ├── voicecmd/        # 语音口令
│   ├── download/        # 下载
│   └── handlers/        # HTTP API
├── static/              # 插件 Web UI
├── tests/               # Vitest
├── scripts/             # 构建辅助、版本、manifest
└── docs/                # 设计与 API 文档
```

洛雪协议对外路径（无需 JWT，写在 `plugin.json` → `publicPaths`）：

| 路径 | 用途 |
|------|------|
| `GET .../hello` | 连通探测 |
| `GET .../id` | 服务端 ID |
| `GET .../ah` | 鉴权 |
| `WS  .../socket` | 列表同步 |

完整服务器地址形如：

```text
http://<host>:<port>/api/v1/jsplugin/starlight
```

---

## 其他插件调用

HTTP API 前缀：

```text
/api/v1/jsplugin/starlight
```

接口说明见 [docs/starlight-plugin-api.md](docs/starlight-plugin-api.md)。

---

## 使用建议

1. **播放源 / 下载源分开** 导入与启用。  
2. 导入曲库时只存可解析的远程曲目；播放时再按歌名+歌手多源匹配。  
3. **洛雪改密钥后**：在 Starlight 复制新密钥 → 洛雪关闭同步 → 填新密钥再启用；不要用旧密钥重连。  
4. 语音口令依赖对话监听，先托管并选中音箱设备。  
5. 大歌单首次同步到 Songloft 会联网解析音质与歌词，耗时与曲目量、网络有关。  

---

## 权限说明

宿主需授予（见 `plugin.json`）：`storage`、`songs.*`、`playlists.*`、`jsenv`（音源脚本）、`websocket`（洛雪同步）、`command`、`inter-plugin` 等。

---

## 文档与变更

- 插件 API：`docs/starlight-plugin-api.md`  
- 洛雪服务端设计：`docs/superpowers/specs/2026-07-18-lx-sync-server-mode-design.md`  
- 变更记录：`CHANGELOG.md`（若有）  

问题与反馈：请到 GitHub Issues 提交。
