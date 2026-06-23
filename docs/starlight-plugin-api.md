# Starlight 插件接口文档

本文档面向需要调用 Starlight 能力的其他 Songloft JS 插件。

## 基础信息

插件入口：

```text
starlight
```

完整基础路径：

```text
http://<songloft-host>/api/v1/jsplugin/starlight
```

示例：

```text
http://192.168.31.63:18191/api/v1/jsplugin/starlight
```

其他插件调用 Starlight API 时，需要拼接具体接口路径：

```text
POST http://<songloft-host>/api/v1/jsplugin/starlight/api/music/search
```

## 认证

插件 API 运行在 Songloft 插件运行时路由下，通常需要 Songloft access token。

推荐请求头：

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```

JS 插件中可通过 Songloft SDK 获取宿主地址和 token：

```js
const host = await songloft.plugin.getHostUrl();
const token = await songloft.plugin.getToken();

const response = await fetch(`${host}/api/v1/jsplugin/starlight/api/music/platforms`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
});
```

## 响应格式

新接口大多使用统一响应格式：

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

失败时：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "BAD_REQUEST",
    "message": "keyword is required",
    "retryable": false,
    "details": {}
  }
}
```

部分 MIoT 兼容接口仍使用旧格式：

```json
{
  "success": false,
  "error": "account_id is required"
}
```

调用方建议同时兼容 `error.message` 和 `error` 字符串。

## 通用数据结构

### SearchResultSong

搜索、导入、下载、音箱推送相关接口常用该结构：

```json
{
  "title": "稻香",
  "artist": "周杰伦",
  "album": "魔杰座",
  "duration": 223,
  "cover_url": "https://example.com/cover.jpg",
  "source_data": {
    "platform": "kw",
    "quality": "320k",
    "songInfo": {}
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 歌曲名 |
| `artist` | string | 否 | 歌手 |
| `album` | string | 否 | 专辑 |
| `duration` | number | 否 | 秒 |
| `cover_url` | string | 否 | 封面 URL |
| `source_data.platform` | string | 是 | 平台 ID，例如 `kw`、`kg`、`tx`、`mg`、`wy` |
| `source_data.quality` | string | 是 | 音质，例如 `128k`、`320k`、`flac`、`flac24bit` |
| `source_data.songInfo` | object | 是 | 平台或 LX 音源返回的原始歌曲信息 |

### 播放模式

音箱播放相关接口支持：

| 值 | 说明 |
| --- | --- |
| `order` | 顺序播放 |
| `random` | 随机播放 |
| `single` | 单曲循环 |
| `loop` | 列表循环 |

## 音乐接口

### 获取平台列表

```http
GET /api/music/platforms
```

返回当前支持的平台列表。

### 获取播放音源列表

```http
GET /api/music/sources
```

返回已导入的播放音源。

### 导入播放音源

```http
POST /api/music/sources/import
```

请求体：

```json
{
  "filename": "source.js",
  "content": "lx.send('inited', ...)"
}
```

### 启用或禁用播放音源

```http
POST /api/music/sources/toggle
```

请求体：

```json
{
  "id": "source-id",
  "enabled": true
}
```

### 删除播放音源

```http
DELETE /api/music/sources/:id
```

### 搜索歌曲

```http
POST /api/music/search
```

请求体：

```json
{
  "keyword": "稻香 周杰伦",
  "source_id": "kw",
  "page": 1,
  "page_size": 20
}
```

说明：

- `source_id` 是平台 ID。
- `page` 默认为 `1`。
- `page_size` 默认为 `30`，最大 `100`。

### 解析歌曲 URL

```http
POST /api/music/url
```

请求体：

```json
{
  "source_data": {
    "platform": "kw",
    "quality": "320k",
    "songInfo": {}
  }
}
```

成功响应：

```json
{
  "url": "https://example.com/audio.mp3"
}
```

注意：该接口返回的是原始 JSON，不包裹 `success/data/error`。

### 推荐歌单

```http
GET /api/music/songlist/list?source_id=kw&page=1&page_size=20
```

### 搜索歌单

```http
POST /api/music/songlist/search
```

请求体：

```json
{
  "keyword": "周杰伦",
  "source_id": "kw",
  "page": 1,
  "page_size": 20
}
```

### 歌单详情

```http
GET /api/music/songlist/detail?source_id=kw&id=3114012822&page=1&page_size=20
```

### 榜单列表

```http
GET /api/music/leaderboard/boards?source_id=kw
```

### 榜单歌曲

```http
GET /api/music/leaderboard/list?source_id=kw&id=kw__16&page=1&page_size=20
```

## Songloft 桥接接口

### 预解析歌曲 URL

```http
POST /api/bridge/preview-url
```

请求体：

```json
{
  "song": {
    "title": "稻香",
    "artist": "周杰伦",
    "source_data": {
      "platform": "kw",
      "quality": "320k",
      "songInfo": {}
    }
  }
}
```

响应：

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/audio.mp3"
  },
  "error": null
}
```

### 导入 Songloft 歌曲库

```http
POST /api/bridge/songs/import
```

请求体：

```json
{
  "songs": [
    {
      "title": "稻香",
      "artist": "周杰伦",
      "album": "魔杰座",
      "duration": 223,
      "cover_url": "https://example.com/cover.jpg",
      "source_data": {
        "platform": "kw",
        "quality": "320k",
        "songInfo": {}
      }
    }
  ]
}
```

说明：

- Starlight 会先解析播放 URL，再调用 Songloft 原生远程歌曲接口写入曲库。
- 普通导入按纯远程歌曲写入，不使用虚拟 `plugin_entry_path`。

### 推送单曲到音箱

```http
POST /api/bridge/play-url
```

请求体：

```json
{
  "account_id": "xiaomi-account-id",
  "device_id": "miot-device-id",
  "song": {}
}
```

### 推送歌单到音箱

```http
POST /api/bridge/play-songlist
```

请求体：

```json
{
  "account_id": "xiaomi-account-id",
  "device_id": "miot-device-id",
  "songs": []
}
```

### 按歌曲名解析并推送音箱

```http
POST /api/bridge/play-resolved-url
```

请求体：

```json
{
  "account_id": "xiaomi-account-id",
  "device_id": "miot-device-id",
  "title": "稻香",
  "artist": "周杰伦"
}
```

### 外部搜索

```http
POST /api/bridge/external-search
```

请求体：

```json
{
  "keyword": "稻香 周杰伦"
}
```

## 下载接口

### 获取下载音源列表

```http
GET /api/download/sources
```

### 导入下载音源

```http
POST /api/download/sources/import
```

请求体：

```json
{
  "filename": "download-source.js",
  "content": "lx.send('inited', ...)"
}
```

### 启用或禁用下载音源

```http
POST /api/download/sources/toggle
```

请求体：

```json
{
  "id": "download-source-id",
  "enabled": true
}
```

### 删除下载音源

```http
DELETE /api/download/sources/:id
```

### 获取下载设置

```http
GET /api/download/settings
```

### 保存下载设置

```http
POST /api/download/settings
```

请求体：

```json
{
  "path_template": "downloads/{artist}/{title}",
  "embed_metadata": true,
  "download_interval": 3
}
```

### 下载单曲

```http
POST /api/download/song
```

请求体：

```json
{
  "song": {}
}
```

当前实现会启动一个 1 首歌曲的批量下载任务。进度通过 `/api/download/batch/progress` 查询。

### 批量下载

```http
POST /api/download/batch
```

请求体：

```json
{
  "songs": []
}
```

### 查询下载进度

```http
GET /api/download/batch/progress
```

### 清空下载进度

```http
POST /api/download/batch/clear
```

## 自建歌单接口

### 获取自建歌单

```http
GET /api/custom-playlists
```

### 创建自建歌单

```http
POST /api/custom-playlists
```

请求体：

```json
{
  "name": "我的歌单"
}
```

### 导入外部歌单

```http
POST /api/custom-playlists/import
```

请求体：

```json
{
  "source_id": "kw",
  "id": "3114012822"
}
```

也支持用 `sourceListId`、`source_list_id`、`link` 或 `url` 传入歌单 ID 或链接。

### 刷新外部导入歌单

```http
POST /api/custom-playlists/:id/refresh
```

### 同步到 Songloft 歌单

```http
POST /api/custom-playlists/:id/sync-songloft
```

### 添加歌曲到自建歌单

```http
POST /api/custom-playlists/:id/songs
```

请求体：

```json
{
  "song": {
    "title": "为龙",
    "artist": "河图",
    "source_data": {
      "platform": "kg",
      "quality": "320k",
      "songInfo": {}
    }
  }
}
```

如果不传 `source_data`，Starlight 会按歌曲名和歌手保存为可检索歌曲。

### 重命名自建歌单

```http
PUT /api/custom-playlists/:id
```

请求体：

```json
{
  "name": "新歌单名"
}
```

### 删除自建歌单

```http
DELETE /api/custom-playlists/:id
```

## Songloft 曲库接口

这些接口封装 Songloft 原生歌曲库和歌单读取能力，便于其他插件统一调用。

### 获取歌曲库

```http
GET /api/songloft/songs
```

### 获取 Songloft 歌单

```http
GET /api/songloft/playlists
```

### 获取歌单歌曲

```http
GET /api/songloft/playlists/:id/songs
```

### 获取本地歌曲

```http
GET /api/songloft/local-songs
```

### 推送 Songloft 歌曲到音箱

```http
POST /api/songloft/player/song
```

请求体：

```json
{
  "account_id": "xiaomi-account-id",
  "device_id": "miot-device-id",
  "play_mode": "single",
  "song": {
    "id": 1,
    "title": "本地歌曲",
    "artist": "歌手",
    "url": "/api/v1/songs/1/play"
  }
}
```

## MIoT 账号与设备接口

以下接口保留智能音箱插件兼容格式。

### 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/accounts` | 创建账号 |
| `GET` | `/accounts` | 获取账号列表 |
| `GET` | `/account?account_id=...` | 获取单个账号 |
| `DELETE` | `/account?account_id=...` | 删除账号 |

### 登录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/auth/qrcode` | 发起扫码登录 |
| `POST` | `/auth/qrcode/poll` | 轮询扫码状态 |
| `POST` | `/auth/relogin` | 重新登录账号 |
| `GET` | `/auth/status` | 查询登录状态 |
| `POST` | `/auth/login` | 账密登录，当前 UI 默认隐藏 |
| `POST` | `/auth/token` | 手动 token 登录，当前 UI 默认隐藏 |

### 设备与音箱控制

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/mina/devices` | 获取所有账号设备 |
| `GET` | `/mina/devices?account_id=...` | 获取单账号设备 |
| `POST` | `/mina/volume` | 设置音量，`volume` 范围 0-100 |
| `POST` | `/mina/play-url` | 播放 URL |
| `POST` | `/mina/pause` | 暂停播放 |
| `POST` | `/mina/resume` | 继续播放 |
| `POST` | `/mina/device/managed` | 设置设备是否托管 |
| `POST` | `/mina/last_selection` | 保存最后选择的设备 |

### 播放队列

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/playlists` | 获取 Songloft 歌单 |
| `GET` | `/playlists/:id/songs` | 获取歌单歌曲 |
| `POST` | `/player/play` | 在音箱播放 Songloft 歌单 |
| `POST` | `/player/stop` | 停止 |
| `POST` | `/player/toggle` | 暂停或继续 |
| `POST` | `/player/previous` | 上一首 |
| `POST` | `/player/next` | 下一首 |
| `POST` | `/player/mode` | 设置播放模式 |
| `GET` | `/player/status?account_id=...&device_id=...` | 获取播放状态 |

## 配置、索引、对话和定时任务

这些接口主要供 Starlight UI 使用，其他插件如需集成可调用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/config` | 获取插件配置 |
| `POST`/`PUT` | `/config` | 保存插件配置 |
| `GET` | `/indexing/status` | 获取索引状态 |
| `POST` | `/indexing/refresh` | 刷新歌曲和歌单索引 |
| `GET` | `/conversation/messages` | 获取最近对话 |
| `GET` | `/conversation/status` | 获取对话监听状态 |
| `POST` | `/conversation/webhooks` | 添加对话 webhook |
| `GET` | `/conversation/webhooks` | 获取 webhook |
| `DELETE` | `/conversation/webhooks` | 删除 webhook |
| `GET` | `/voice-commands` | 获取语音口令配置 |
| `POST` | `/voice-commands` | 保存语音口令配置 |
| `POST` | `/voice-commands/ai-test` | 测试 AI 口令分析 |
| `GET` | `/schedules` | 获取定时任务 |
| `POST` | `/schedules` | 创建定时任务 |
| `POST` | `/schedules/update` | 更新定时任务 |
| `DELETE` | `/schedules` | 删除定时任务 |
| `POST` | `/schedules/toggle` | 启用或禁用定时任务 |
| `GET` | `/schedules/logs` | 获取定时任务日志 |

## 健康检查

### 概览

```http
GET /api/health/summary
```

### 日志

```http
GET /api/health/logs
```

### 清空日志

```http
POST /api/health/logs/clear
```

## 调用示例

### 搜索并导入 Songloft 曲库

```js
const host = await songloft.plugin.getHostUrl();
const token = await songloft.plugin.getToken();
const base = `${host}/api/v1/jsplugin/starlight`;

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    const message = body.error?.message || body.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body.data ?? body;
}

const search = await call('/api/music/search', {
  method: 'POST',
  body: JSON.stringify({
    keyword: '稻香 周杰伦',
    source_id: 'kw',
    page: 1,
    page_size: 20,
  }),
});

await call('/api/bridge/songs/import', {
  method: 'POST',
  body: JSON.stringify({
    songs: search.list.slice(0, 5),
  }),
});
```

### 推送歌曲到音箱

```js
await call('/api/bridge/play-resolved-url', {
  method: 'POST',
  body: JSON.stringify({
    account_id: 'xiaomi-account-id',
    device_id: 'miot-device-id',
    title: '稻香',
    artist: '周杰伦',
  }),
});
```

## 注意事项

- 其他插件调用 Starlight 时，应使用宿主地址加 `/api/v1/jsplugin/starlight` 前缀。
- 调用 `/api/music/url` 时，响应不使用统一 envelope，而是直接返回 `{ "url": "..." }`。
- MIoT 兼容接口可能返回 `{ success, error }` 的旧格式。
- 歌曲导入、下载、音箱播放都依赖音源可用性。调用方应处理 `PLAY_URL_RESOLVE_FAILED`、`DEVICE_OFFLINE`、`INTERNAL_ERROR` 等错误。
- 下载音源和播放音源是两套独立配置，不应混用。
