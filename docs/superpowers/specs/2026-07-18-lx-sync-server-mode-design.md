# Starlight 洛雪同步：服务器模式设计

日期: 2026-07-18  
分支: `feat/ui-miot-lx-sync`

## 1. 目标

Starlight 作为 **LX Music 同步协议服务端**，与本机/局域网内的：

- [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)
- [lx-music-mobile](https://github.com/lyswhut/lx-music-mobile)

互通；**不**依赖独立 lxserver 进程；**不**使用 JSON 粘贴导入 UI。

## 2. 角色

| 角色 | 软件 |
|------|------|
| 服务器 | Starlight 插件（Songloft 内） |
| 客户端 | LX 桌面 / LX 移动端 |

用户在 Starlight UI 查看 **服务器地址** 与 **同步密钥**；在 LX 客户端「同步服务」中填入同一地址与密钥。

## 3. 协议（与官方客户端兼容）

基址示例：`http://{songloft_host}/api/v1/jsplugin/starlight`

| 步骤 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 探活 | GET | `/hello` | 正文 `Hello~::^-^::~v4~` |
| 服务 ID | GET | `/id` | 正文 `OjppZDo6` + serverId |
| 鉴权 | * | `/ah` | header `m`（及可选 `i`） |
| 同步 | WebSocket | `/socket?i=&t=` | message2call RPC，list 模块 |

加密：

- 首次密钥：`base64(utf8(md5(密钥).slice(0,16)))`，AES-128-ECB
- 会话密钥：服务端随机 16 字节 base64，经 RSA-OAEP-SHA1 回传客户端公钥
- 大报文：`cg_` + gzip(base64)

设备标记：鉴权正文第 4 行为 `lx_music_desktop` 或 `lx_music_mobile`。

## 4. 数据映射

- 服务端「本地 ListData」= 自建歌单 export（现有 `mapPlaylistsToListData`）
- 收到客户端 ListData 后 import（现有 `importList` / mapper）
- 同步模式：由客户端弹窗选择；服务端用 `TRANS_MODE` 翻转语义后执行 merge/overwrite
- v1：list only；dislike 不启用；不做复杂 snapshot 三方合并（无快照时走 full list 路径）

## 5. 配置

```ts
{
  password: string;          // 同步密钥
  serverId: string;          // 稳定 ID
  serverName: string;        // 展示名，默认 Starlight
  enabled: boolean;
  lastSyncAt?: string;
  devices?: ClientKeyInfo[]; // 已授权设备（storage 分 key 也可）
}
```

UI：只读地址 + 可复制；密钥可编辑/重新生成；启用开关；连接设备列表与状态。  
协议本地 ListData 仅导出 `sourceListId` 以 `lx:` 开头的歌单（不把用户自建非洛雪歌单推给客户端）。

## 6. 公开路径

`plugin.json`：

```json
"publicPaths": ["/hello", "/id", "/ah", "/socket"]
```

管理 API 仍需 JWT：`/api/lx-sync/config` 等。

## 7. 非目标

- 独立 lxserver 进程
- JSON 粘贴导入 UI
- dislike 同步
- 多用户路径 `/username/ah`
- 完整多设备实时广播（v1 可只处理当前连接）

## 8. 验收

1. UI 无 JSON 区，有地址与密钥  
2. 桌面端用地址+密钥可连接并同步歌单  
3. 移动端同一地址+密钥可连接并同步  
4. 不启动外部 lxserver  
