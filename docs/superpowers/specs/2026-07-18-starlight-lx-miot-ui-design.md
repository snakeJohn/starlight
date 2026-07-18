# Starlight：洛雪歌单同步 · MIoT 对齐 · iOS 26 UI 重构

日期: 2026-07-18  
分支: `feat/ui-miot-lx-sync`

## 1. 目标

在同一功能分支交付三块能力：

1. **洛雪歌单同步**：连接用户自建的 LX Sync Server（兼容 `XCQ0607/lxserver` / 上游 `lx-music-sync-server` 数据模型），拉取歌单并导入 Starlight 自建歌单，可选再同步到 Songloft。
2. **MIoT 代码同步**：对照 `_refs/songloft-plugin-miot` 上游，把音箱相关修复与能力回填到 Starlight，不破坏 Starlight 独有的音乐桥接、下载、自建歌单逻辑。
3. **UI 全面重构**：视觉对齐 iOS 26 Liquid Glass（半透明表面、大圆角、分层毛玻璃、系统字体、底部 Tab / 侧栏自适应），保持工具型信息密度与现有 `data-role` / `data-action` 契约，避免无故破坏 UI 测试。

## 2. 约束（Global Constraints）

- 仓库根即插件工程；入口 `entryPath = starlight`。
- 运行在 Songloft QuickJS；`fetch` 可用；**不要**依赖 Node 内置模块。
- 不在仓库提交 `_refs/`、账号、token、私人音源。
- 不内置/分发第三方 LX 音源脚本。
- 日志禁止输出密码、Token、Cookie、API Key。
- 构建 hash 不手改；由 builder 生成。
- 测试：相关模块补 Vitest；改完后 `npm run typecheck` 与 `npm test` 应可通过。
- **文件所有权（并行防冲突）**：
  - Agent A（LX）：`src/lx_sync/**`、`src/handlers/lx_sync.ts`、`tests/**/lx_sync*`、`static/js/music_modules/lx_sync.js`；可最小改动 `src/main.ts`、`src/config/manager.ts`、`src/types.ts`、`static/index.html`（仅 LX 区块）、`static/js/music.js`（仅 import/init 一行）、`static/js/state.js`（仅 LX 字段/tab）。
  - Agent B（MIoT）：`src/mina/**`、`src/auth/**`、`src/account/**`、`src/service/**`、`src/player/**`、`src/conversation/**`、`src/schedule/**`、`src/voicecmd/**`、`src/handlers/{account,auth,device,playlist,conversation,schedule,voice_command,config}.ts`、对应 tests；**不改** `static/**`、`src/music/**`、`src/lx_sync/**`、`src/download/**`、`src/bridge/**`（除非为编译所必需的类型）。
  - Agent C（UI）：`static/css/**`、`static/index.html`（布局/类名）、`static/js/app.js`、`static/icon.svg`、必要时 `static/js/state.js` 的导航图标文案；**不得删除** 已有 `data-role` / `data-action` / form name；**不改** `src/**`。
- 合并顺序建议：B → A → C（后端先、壳最后）。

## 3. 洛雪歌单同步设计

### 3.1 协议选择

**v1 使用 HTTP API（非完整 WebSocket RPC）**，对齐 lxserver 网页端 `LocalClient`：

| 步骤 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 登录 | POST | `{base}/api/user/login` | body: `{ username, password }` → `{ success, token }` |
| 拉歌单 | GET | `{base}/api/user/list` | header: `x-user-token: <token>` → `ListData` |
| 可选推送 | POST | `{base}/api/user/list` | 完整覆盖 ListData（v1 可只实现拉取+导入） |

`base` 为用户配置的同步服务根地址（如 `http://192.168.1.10:9527`），需规范化去掉尾部 `/`。

### 3.2 ListData 形状（LX）

```ts
// 简化
interface LxListData {
  defaultList: LxMusicInfo[];
  loveList: LxMusicInfo[];
  userList: Array<{
    id: string;
    name: string;
    source?: string;
    sourceListId?: string | number;
    locationUpdateTime?: number | null;
    list: LxMusicInfo[];
  }>;
}

interface LxMusicInfo {
  id: string;
  name: string;
  singer: string;
  source: string; // kw|kg|tx|mg|wy|local|...
  interval: string | null; // "03:55"
  meta: {
    songId?: string | number;
    albumName?: string;
    picUrl?: string | null;
    hash?: string;
    // 平台特有字段保留进 source_data
    [k: string]: unknown;
  };
}
```

### 3.3 映射到 Starlight 自建歌单

- `loveList` → 自建歌单名「我喜欢」
- `defaultList` → 自建歌单名「默认列表」（可选开关，默认导入）
- 每个 `userList[i]` → 自建歌单 `name`，meta 带 `source: lx_sync`、`native_playlist_id: id`
- 歌曲：`title=name`、`artist=singer`、`album=meta.albumName`、`cover_url=meta.picUrl`
- `duration`：解析 `interval`（`mm:ss` / `hh:mm:ss`）为秒
- `source_data`：若 `source` 为 `kw|kg|tx|mg|wy`，构造与现有 `SearchResultSong.source_data` 兼容结构（`platform` + `songInfo` 填 musicId/hash/songmid 等），便于后续解析播放 URL；否则仅 portable 字段（title/artist）
- `stable_key`：优先 `lx:{source}:{id}`，否则 `query:title:artist`

### 3.4 同步策略

- **Pull → Import**：从服务器拉 ListData，合并进 CustomPlaylistStore
  - 默认 **upsert by native_playlist_id / 固定名称（我喜欢）**
  - 冲突策略：`replace`（整单替换歌曲，默认）| `merge`（按 stable_key 并集）
- **Push**：v1 可选；若实现，从自建歌单组装 ListData 再 POST（需警告：全量覆盖服务器数据）
- 配置持久化：`starlight:lx_sync:config` = `{ baseUrl, username, token?, lastSyncAt?, importDefaultList: true, conflict: 'replace' }`
  - 密码只用于登录拿 token，**不落盘**；token 可落盘（用户插件私有 storage）
- API 路由（插件侧）：
  - `GET/PUT /api/lx-sync/config`（PUT 不含回显 password）
  - `POST /api/lx-sync/connect` body: `{ baseUrl, username, password }` → 登录并保存 token
  - `POST /api/lx-sync/disconnect`
  - `POST /api/lx-sync/pull` → 拉取并导入，返回统计
  - `GET /api/lx-sync/preview` → 拉取但不写入，返回歌单摘要
  - `POST /api/lx-sync/import-to-songloft` optional：选中的自建歌单 id 列表 → 走现有 `CustomPlaylistService.syncToSongloftPlaylist` / SongloftPlaylistService

### 3.5 UI 入口（由 UI agent 留壳 + LX agent 填逻辑）

- 歌单 Tab 或独立区块「洛雪同步」：服务器地址、用户名、密码、连接、预览、同步、状态文案。
- 使用 `data-role` / `data-action` 前缀 `lx-sync-*`，便于测试。

## 4. MIoT 对齐设计

### 4.1 对照范围

参考 `_refs/songloft-plugin-miot`（已克隆）。差异重点：

| 模块 | 现象 | 动作 |
|------|------|------|
| `mina/client.ts` | miot 更大 | 合入修复/API，保留 starlight 调用方 |
| `mina/auth.ts` | miot 更大 | 合入扫码/登录修复 |
| `service/service.ts` | miot 更大 | 合入播放控制能力 |
| `handlers/device.ts` | miot 更大 | 合入设备列表/选择 |
| `handlers/config.ts` | miot 有更多项 | 合入音箱相关配置字段，不删 starlight 音乐配置 |
| `voicecmd/engine.ts` | 两边都有演进 | **谨慎 diff**，保留 starlight 的 Songloft/自建歌单/下载路径 |
| `handlers/memory.ts` 等 | starlight 无 | **不移植** memory 子系统（超出本需求） |
| `ws/` | starlight 无 | 若仅为 memory，跳过 |

### 4.2 原则

- 逐文件 diff，以 **行为修复与 API 兼容** 优先，禁止无脑整文件覆盖。
- Starlight 特有逻辑（Bridge、Download、CustomPlaylist、Songloft library）保留。
- 新增配置键必须可序列化且有默认值；前端音箱设置若缺 UI 字段，后端仍可工作。
- 每处行为变更补或更新测试。

## 5. iOS 26 UI 设计

### 5.1 视觉语言

- **Liquid Glass**：`.surface-section` 使用半透明 + `backdrop-filter: blur(20-40px)` + 细边框 `color-mix` hairline。
- **圆角**：卡片 16–22px，控件 12px，按钮胶囊。
- **层级**：背景 soft gradient mesh（轻量 CSS），内容卡片浮起，全局播放条与底栏 glass。
- **字体**：`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui`；标题 semibold，副文案 muted。
- **强调色**：沿用宿主 `--md-sys-color-primary` / 回退 iOS 蓝 `#0A84FF`。
- **深浅色**：`color-scheme: light dark` + host tokens。
- **动效**：tab 切换 150–200ms ease；按钮 active scale 0.98；尊重 `prefers-reduced-motion`。
- **布局**：桌面侧栏 + 内容；移动底栏；安全区 `env(safe-area-inset-*)`。

### 5.2 结构

- 保留现有 tab：`search / speaker / songlists / rankings / sources / logs / automation`。
- 歌单页增加「洛雪同步」卡片（HTML 骨架）。
- 导航图标：用 SVG sprite 或 inline SVG（不用 emoji 糊弄）；可在注释中给出 GPT-Image-2 提示词供用户生成品牌图。
- **禁止** 重写业务 JS 逻辑；只改呈现层与最小接线。

### 5.3 图标素材提示词（给用户 GPT-Image-2）

见实现后的 `docs/superpowers/specs/2026-07-18-ui-asset-prompts.md`（UI agent 产出）。

## 6. 测试

- LX：mapper 单测、config 脱敏、pull mock fetch、handler 路由。
- MIoT：沿用现有 mina/auth/device/player 测试，修复失败项。
- UI：`tests/ui/static_layout.test.ts` 等仍能找到关键 data-role；新增 lx-sync 节点断言。

## 7. 非目标（本轮不做）

- 完整 LX WebSocket RPC 双向实时同步客户端。
- 移植 miot memory / 全文搜索 registry。
- 重写音乐平台 provider。
- 发布到 GitHub Release（除非用户另指令）。
