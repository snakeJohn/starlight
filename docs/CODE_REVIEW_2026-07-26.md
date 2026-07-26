# 代码审查与修复跟踪 — 2026-07-26

分支 `fix/rebuild-post-grok`。按子系统分区审查，逐项记录：问题 → 影响 → 状态。

**基线**：`npm run typecheck` 通过，`npx vitest run` 632 tests / 100 files 全绿。

**状态图例**：`✅ 已修复` · `🔧 修复中` · `📋 待修复（含思路）` · `⏸ 已评估不改（含理由）`

---

## 汇总

| 区域 | 已修复 | 待修复 | 已评估不改 |
|---|---|---|---|
| 通用工具 / 系统层 | 5 | 0 | 1 |
| 歌词解析 | 3 | 0 | 0 |
| 播放器（后端） | 1 | 0 | 0 |
| 索引 / 语音匹配 | 1 | 0 | 0 |
| 对话监听 / Webhook | 2 | 0 | 0 |
| 前端 UI | 9 | 0 | 4 |
| 自建歌单 / 认证 / 凭据 | 10 | 1 | 3 |
| 小米 MIoT / 登录 / 二维码 | 7 | 0 | 8 |
| 语音口令引擎 | 11 | 0 | 4 |
| 音源 / 桥接 | 6 | 1 | 4 |
| HTTP handlers / 下载 | 8 | 0 | 6 |
| 洛雪同步 | 13 | 0 | 7 |
| 定时任务 / 节假日数据 | 0 | 1 | 1 |
| **合计** | **76** | **3** | **38** |

全部 13 个区域审查完毕。计数以下方条目为准；个别条目合并了同因同修的多个位置（如 C20 含 2 处、C40 含 4 个端点）。

---

## 一、安全

### ✅ S1 · Webhook 校验存在 SSRF 绕过
`src/utils/url_safety.ts:10`

`isBlockedHostname` 只识别点分四段 IPv4。`http://2130706433`、`http://0x7f000001`、`http://017700000001`、`http://127.1` 都解析到 127.0.0.1，却被判为「普通主机名」放行，可探测宿主内网与云元数据端点（169.254.169.254）。

**修复**：新增 `normalizeIpv4Literal`，按 inet_aton 规则展开 1~4 段的十进制 / 八进制 / 十六进制字面量再走 CIDR 判定。
**测试**：`tests/utils/url_safety.test.ts` — 四种绕过形式 + 「看起来像数字的公网主机不误伤」。

### ✅ S2 · 历史 Webhook 绕过校验直接投递
`src/conversation/monitor.ts:464`

`sendWebhook` 直接 `fetch(wh.url)`。S1 收紧前存入的地址仍会被长期投递，等于留下一条常驻 SSRF 通道。

**修复**：投递前重新跑 `validateOutboundWebhookUrl`，不通过则拒发。

### ✅ S3 · Webhook 返回非 2xx 被记为成功
`src/conversation/monitor.ts:489`

只 `await fetch(...)` 未看 `response.ok`，接收端 500 也打印「Webhook sent」。

**修复**：`response.ok === false` 时抛错，交由既有的 `Promise.allSettled` 失败分支记录。

### ✅ S4 · 账号列表页泄露设备行内容（XSS）
`static/js/speaker_modules/devices.js:125`

`account.auth_type || account.status` 原样拼进 `innerHTML`。
**修复**：`escapeHtml(...)` 包裹。

### ✅ S5 · 洛雪设备列表 XSS
`static/js/music_modules/lx_sync.js:75`

`formatTime(device.lastConnectDate)` 在 `new Date(value)` 无效时原样回吐入参，而该字段由已连接的洛雪客户端控制。
**修复**：`escapeHtml(...)` 包裹。已脚本化扫描 `static/js/**` 全部模板插值，其余命中均为字面量 / 布尔 / 计算数值。

### ✅ S6 · 二维码登录轮询缓存长期驻留凭据
`src/auth/service.ts:31`

`qrPollResults` 缓存了完整 `PollResult`，`tokenInfo`（serviceToken + ssecurity）与 `passToken` 无限期留在内存，且后续每次 `pollQRCode` 都会再返回一次。
**修复**：缓存降为 `state` / `message` / `account_id`。

### ✅ S7 · 插件卸载后会话与 Cookie 未释放
`src/auth/service.ts:562`、`src/auth/session.ts:127`

`cleanup()` 注释写「清理会话」，实际只清了 `lastReloginTime`；`SessionManager` 仍持有各账号的 MD5 密码与 `MinaAuth` 的 CookieJar（含 passToken）。
**修复**：新增 `SessionManager.clear()` 并在 cleanup 调用。

### ✅ S8 · 洛雪 RPC 可沿原型链解析到 `Function` 并被调用
`src/lx_sync/message2call.ts:56`

调度器按客户端提供的 `path` 逐段取属性且不限制来源，`path: ['constructor','constructor']` 会解析到 `Function` 然后被 `.apply()`。同步端口对局域网开放。
**修复**：每一段都必须是自有属性（own property）。

---

## 二、正确性

### ✅ C1 · LRC 毫秒未补零，歌词时间轴解析失败 / 错位
`src/music/platforms/lyrics.ts:234`（网易云）、`:736`（酷狗）、`:915`（咪咕）

三处都用 `timeMs % 1000` 直接拼字符串。前端 `parseLrc` 的时间标签正则是 `\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]`：
- `[00:00.0]`（毫秒 < 10）**完全不匹配**，整行歌词被丢弃；
- `[01:05.20]` 被按 2 位小数解析成 200ms，实际是 20ms。

即网易云逐字歌词、酷狗 krc、咪咕 mrc 的时间轴系统性偏移或整行丢失。

**修复**：抽出 `lrcMsLabel()`，毫秒统一 `padStart(3,'0')`。
**测试**：`tests/music/lyrics.test.ts` 断言更新为 `[00:00.000]`。

### ✅ C2 · 咪咕歌词解密依赖 Node `Buffer`，插件运行时必崩
`src/music/platforms/lyrics.ts:827`

`miguLongToBytes` 用 `Buffer.alloc(8)` + `.toString('utf16le')`，且**没有** `typeof Buffer !== 'undefined'` 守卫——同文件其它 Buffer 用法都有。插件跑在 QuickJS 上没有 `Buffer`，咪咕 mrc 歌词必抛 ReferenceError；vitest 在 Node 下跑，测试反而看不出来。

**修复**：改为纯 JS `miguLongToUtf16le()`，用 BigInt 掩码取低 16 位逐个 `String.fromCharCode`，与原 LE 字节对读语义等价。

### ✅ C3 · 分钟换算系数错误导致翻译歌词丢行
`src/music/platforms/lyrics.ts:310`

`neteaseIntervalMs` 用 `minute * 3600000`（一小时的毫秒数）而非 `60000`。两侧都用同一函数，同分钟内差值可抵消，但**跨分钟边界**时：原文 `[00:59.950]` 与译文 `[01:00.000]` 真实相差 50ms（在 100ms 容差内应对齐），按错误系数算成 3540050ms，对齐失败，该行译文被丢弃。

**修复**：改为 `60000`。
**测试**：`tests/music/lyrics.test.ts` 新增跨分钟边界用例；已实测**改前失败、改后通过**。

### ✅ C4 · 标准 `Headers` 下响应头全部丢失
`src/utils/http.ts:63`

`httpFetch` 用 `Object.keys(resp.headers)` 提取响应头。这只对 QuickJS polyfill 的普通对象有效；标准 `Headers` 实例自有属性为空，`Object.keys` 返回 `[]`，于是 **Location / Set-Cookie 等全部丢失**——小米登录的多跳 3xx + Cookie 收集链会直接断掉。

**修复**：新增 `readResponseHeaders()`，优先用 `headers.forEach` 与原生 `getSetCookie()`，普通对象走原路径；`collectCookies` 在只拿到单条头时仍走 `splitSetCookieHeader` 拆分。
**测试**：`tests/utils/http_host.test.ts` 覆盖两种 headers 形态。

### ✅ C5 · 调用方主动 abort 被误报为超时
`src/utils/fetch_timeout.ts:53`

`catch` 里用 `controller.signal.aborted` 判定，但父 signal 触发时该标志同样为 true，于是外部取消被包装成 `FetchTimeoutError`，上层重试逻辑会误判。
**修复**：用独立的 `timedOut` 标志，只有自己的定时器触发才算超时。

### ✅ C6 · 暂停进度跨曲残留
`src/player/manager.ts:238/295/700`

`play()` / `playStandalone()` / `initWithSongs()` 都重置了 `state` 和 `playStartTimeMs`，但漏了 `pausedElapsedSec`。播放失败后若状态回到 paused，`getPosition()` 会返回上一首的进度。
**修复**：三处一并清零。

### ✅ C7 · 自建歌单加歌存在丢更新竞态
`src/custom_playlists/service.ts:225`

快照由 `create()` 取得，中间经过 `resolveSongForOwnPlaylist`、`importSongs` 两次网络 await，最后用整对象 `replace()` 写回。两个并发 `addSong`（或期间落地的洛雪快照）会互相覆盖。
**修复**：追加动作移入 `store.mutate`，基于最新读到的记录做去重与追加；删除已无用的私有 `replace()`。

### ✅ C8 · 自建歌单去重键不匹配导致重复曲目
`src/custom_playlists/service.ts:83`

`stable_key` 实际有三种形态（在线解析的 `platform:id`、网络歌单导入的 `query:title:artist`、宿主快照的 `songloft:id`），去重却只比 `platform:id`，把已存在的曲目再加一遍。
**修复**：新增 `containsSong()`，同时比对归一化后的「标题+歌手」文本键。

### ✅ C9 · 单曲解析失败导致整批导入回滚
`src/songloft/playlist_service.ts:147`

`bridge.resolveSearchSong` 未加保护，任一首歌网络失败即 reject 整个 `importSongsToPlaylist`，已解析好的曲目全部丢弃。
**修复**：逐首包裹，失败进既有 `errors[]` 契约，循环继续。

### ✅ C10 · 旧账号记录缺 `devices` 字段触发 TypeError
`src/security/credentials.ts:147`

`migrateAccountSecrets` 只归一化了 `services`。旧记录若无 `devices`，后续 `ConfigManager.updateDevice` 的 `account.devices.findIndex`、`AccountManager.updateDeviceList` 的 `for…of` 直接抛错。
**修复**：一并归一化为 `[]`。

### ✅ C11 · 账号删除后令牌刷新定时器永不停止
`src/auth/service.ts:578`

`DELETE /accounts` 不调用 `stopTokenRefresh`，2 小时周期的 `setInterval` 会永远存活并每次重读存储。
**修复**：定时器发现账号配置已不存在时自我注销。

### ✅ C12 · `relogin` 缺用户名校验
`src/auth/service.ts:478`

密码分支只判 `password`，与 `refreshToken` / `autoLoginAccount` 不一致，用户名为空时仍会发起一次注定失败的小米登录。
**修复**：补 `accountConfig.account` 判空。

### ✅ C13 · 批量下载进度轮询永不停止
`static/js/music_modules/downloads.js:53`

2 秒轮询只在 `progress.done` 时清除；批次结束或 `/download/batch/clear` 后返回 `{active:false}`，定时器无限续命。
**修复**：`else if (progress?.done)` 改为 `else`。

### ✅ C14 · 初始化重复绑定导致按钮重复触发
`static/js/music.js:286`、`static/js/diagnostics.js:81`

`initMusicUI` / `initDiagnosticsUI` 每次调用都重新注册监听；app.js 的「重试」路径（`runInitializers('failed')`）会让每个按钮多触发一次。
**修复**：加 `musicBindingsBound` / `diagnosticsBindingsBound` 守卫，与 `speaker.js`、`automation.js` 既有写法一致。

### ✅ C15 · 歌单抽屉存在响应乱序
`static/js/speaker_modules/playlists.js:89`

`loadDrawerSongs` 无请求排序：先点歌单 A 再点 B，A 的慢响应会覆盖 B 的歌曲和 `state.speakerPlaylistSongs`。
**修复**：加单调 `drawerSongsRequestId`，过期响应与过期错误一并丢弃。

### ✅ C16 · 加载失败后面板永久停在「正在加载…」
`static/js/speaker_modules/playlists.js:288`、`static/js/music_modules/songloft_library.js:67`

设置了 loading 占位后把 rejection 抛给只做 `toast()`（或 `.catch(() => null)`）的调用方，面板再也不会更新。
**修复**：抛出前先渲染错误态。

### ✅ C17 · 封面 / 歌词异步竞态
`static/js/speaker_modules/player.js:268/311`

快速切歌时，上一首的 `fetchWithAuth` 后到，会把旧封面 / 旧歌词盖到当前曲目上，并残留一个不会被 revoke 的 objectURL。
**修复**：加单调 `coverRequestId` / `lyricRequestId`，且在「内联歌词」和「跨域封面」这两条提前 return 的分支上也自增，确保任何来源切换都能作废在途请求。

### ✅ C18 · MiIO TTS 失败被报成功，音箱静默不播报
`src/mina/miio_client.ts:47`

`textToSpeechByCommand` 在 `miotAction` 返回 `null` 时把 `innerCode` 算成 `0`，于是**所有** MiIO 失败（缺 xiaomiio token、HTTP 错误、RC4 解码失败、外层 code 非 0）都被判为成功。`MinaHTTPClient.textToSpeech` 因此返回 `true` 且**不再回退到 Mina UBus**，最终表现为音箱完全不出声。

**修复**：`result === null` 时先告警并 `return false`，再走 code 判定。

### ✅ C19 · `/music/search` 时间戳单位错误
`src/mina/client.ts:253`

发的是 `Date.now() * 1000`（微秒），xiaomusic 参考实现发的是 `int(time.time()*1000)`（毫秒）。
**修复**：改为 `String(Date.now())`。

### ✅ C20 · 上游返回非数组时抛错中断整条链路
`src/mina/client.ts:268`、`:160`

`searchAudioId` 只判 `!songList || songList.length === 0`，`getDeviceList` 只判 `!result.data`；上游给出非数组时 `.slice()` / `.map()` 直接抛出方法外，触屏歌词播放链路整体中断而非降级。
**修复**：两处均改为 `Array.isArray(...)` 判定。

### ✅ C21 · 负数 int64 精度丢失导致登录签名错误
`src/mina/auth.ts:599`

`extractBigIntField` 的正则 `(\d+)` 不匹配负数，负的 int64 `nonce` 会退回 `JSON.parse` 的双精度并丢掉尾数（`-3057847348874358421` → `-3057847348874358300`），算出错误的 `clientSign`，表现为无从解释的 STS / 登录失败。
**修复**：正则改为 `(-?\d+)`。

### ✅ C22 · 验证码流程丢失 `ick` Cookie，提交必失败
`src/mina/auth.ts:130`

`getCaptchaImage` 用裸 `fetchSync` + `addFromHeaders(rawSetCookie)`，不会拆分逗号折叠的 `Set-Cookie`，第一条之后的 Cookie（通常正是 `ick`）被当成属性吞掉。
**修复**：改走 `fetchWithRedirects(..., this.cookieJar, MAX_REDIRECTS)`，复用其标准拆分与 jar 合并。

### ✅ C23 · 扫码登录轮询并发叠加，误报「二维码已过期」
`src/qrcode/qrcode.ts:311`

`startPolling` 用 `setInterval(async …)` 每 5 秒发一次，而每次 `poll()` 在小米长轮询上要阻塞约 30 秒 —— 6 个以上请求并发在跑，约 2 分钟就烧完 `MAX_POLL_COUNT`(20) 并谎报过期。重入守卫（`pollTimer !== null`）也只在第一个 `await` 之后才置位，且 interval 回调里的抛错会变成 unhandled rejection。

**修复**：改为「上一次 poll 结算后才排下一次」的 `setTimeout` 链，加同步 `polling` 标志与循环 `.catch`。

### ✅ C24 · 候选口令被拒后永久屏蔽同组更短口令
`src/voicecmd/engine.ts:611`

`matchCommand` 在校验候选**之前**就抬高了 `bestKeywordLen`。一个通用播放关键词若随后被拒（偏移不对 / 参数为空 / 参数看着像歌单名），它抬上去的长度值仍然生效，同优先级组里更短但有效的关键词再也匹配不上。
**修复**：长度记账移到所有校验 `continue` 之后。

### ✅ C25 · 智能续播定时器全局共享，跨设备互相取消
`src/voicecmd/engine.ts:421`

所有设备共用一个定时器和一个 `resumeCancelled` 布尔量。两个问题：(a) 任一设备的指令会取消另一设备待触发的续播；(b) `scheduleSmartResume` 取消后立刻把 `resumeCancelled` 置回 false，已在跑的 30 秒轮询循环永远看不到取消信号，于是两个循环并行。
**修复**：改为按 `account:device` 的定时器 Map + 每键 epoch，运行中的循环通过 `isResumeStale` 复查。

### ✅ C26 · 续播定时器回调的 unhandled rejection
`src/voicecmd/engine.ts:1537`

`setTimeout(async () => await this.smartResume(...))`，内部 `getPlayerStatus` 是网络调用，一旦抛出即成为 unhandled rejection。
**修复**：回调改用 `.catch()`，轮询循环内的 `getPlayerStatus` 单独 try/catch。

### ✅ C27 · 插件卸载后续播定时器仍会推播放
`src/voicecmd/engine.ts:455`

`setEnabled(false)`（`onDeinit` 调用）没有清 3 秒续播定时器及其 30 秒轮询，已拆除的插件仍可能把播放推给音箱。
**修复**：一并取消所有待触发的续播。

### ✅ C28 · 歌名含「到」时被错误切分
`src/voicecmd/engine.ts:849`

`parseAddSongArgument` 把裸 `到` 和显式分隔符放进同一个候选集，惰性匹配导致「把回到过去加到收藏」被切成 歌名`回` / 歌单`过去加到收藏`。
**修复**：先尝试显式分隔符（`添加到|加到|加入|放到`），裸 `到` 降为兜底。

### ✅ C29 · 最高分歌单缺 id 时直接放弃全部候选
`src/voicecmd/engine.ts:213`

`findBestPlaylistMatch` 在得分最高的那条没有数字 `id` 时直接返回 `null`，把排名靠后但可用的匹配一并丢掉。
**修复**：向下迭代直到找到带可用 id 的一条。

### ✅ C30 · AI 解析出的歌手信息被丢弃
`src/voicecmd/engine.ts:726`

`play_song` 只透传 `name || artist`，AI 单独抽出的 `artist` 被扔掉，曲库查找与在线搜索的准确度下降。
**修复**：`executePlaySong` 接收可选 `artist`，贯通到 `findSongloftLibrarySong`、`resolveVoiceSearchSong` 以及在线搜索的关键词与 hint。

### ✅ C31 · 「音量调到百分之」被解析成 100
`src/voicecmd/engine.ts:1717`

`extractNumber` 写了 `const target = cleaned || s`，当剥掉「百分之」后串变空时又把原串换回来，正好重新引入这个剥离本要防止的「百 → 100」误判。
**修复**：去掉该兜底。

### ✅ C32 · AI 回复带尾随说明时整段被丢弃
`src/voicecmd/ai_analyzer.ts:195`

兜底提取器只接受「`}` 后仅剩空白」的情形；而模型在 JSON 之后追加说明文字，恰恰是这个兜底存在的理由 —— 此时它一路回退到 `-1` 并产出空串，整个回复作废。另外 `JSON.parse("null")` 会让后续 `parsed.action` 抛错。
**修复**：从最后一个 `}` 起逐个候选位置尝试 `JSON.parse`，取第一个解析成功的；新增 `toAnalysisResult` 统一归一化两条路径并挡住 `null`。

### ✅ C33 · 远程导入无超时，可永久挂起语音播放链路
`src/voicecmd/online_searcher.ts:274`

`importSong` 用裸 `fetch`，而同文件其它调用都用 `fetchWithTimeout`；后端卡住时整条语音播放链路无限等待。
**修复**：改用 `fetchWithTimeout`，10 秒预算。

### ✅ C34 · 响应体未脱敏直接进日志
`src/voicecmd/online_searcher.ts:285`

同文件其它日志点都过 `redactForLog`，这两处漏了。
**修复**：补上。

### ✅ C35 · 状态解析失败污染共享设备状态缓存
`src/handlers/device.ts:288`

`GET /mina/status` 在音箱 `info` 解析失败时，仍把 `state:'unknown', position:0` 写进**共享**的设备状态缓存；4 秒内读同一缓存的 `/player/status` 于是报 `unknown` 并把 UI 进度条清零。
**修复**：只有真正解析出状态时才写缓存。

### ✅ C36 · 回环地址检测漏判带端口/带路径的形式
`src/handlers/config.ts:22`

`isLoopbackAddress` 在 `'/'` **或** `':'` 处切一刀，二者不会同时处理，于是 `http://localhost:18191/x` 和裸 `localhost:18191` 都被判为「正常」，「音箱访问不到该地址」的警告被吞掉。
**修复**：先剥路径再剥端口，并处理 `[::1]` 方括号。

### ✅ C37 · 请求体非法 JSON 被报成 500
`src/handlers/config.ts:125`

两个 `/config` handler 硬编码状态码 `500`，`parseJsonBody` 抛出的 `BAD_REQUEST` 因此变成服务端错误。
**修复**：改用共享的 `httpStatusForError(e)`。

### ✅ C38 · 非字符串时区写入后导致调度器静默停摆
`src/handlers/config.ts:149`

`config.timezone = body.timezone` 不校验类型；非字符串被持久化后，`Scheduler.tick()` 里的 `getZonedParts` 在 `.trim()` 上抛错，而该错误只被记录 —— 定时任务从此再也不触发，且无任何用户可见提示。
**修复**：只接受字符串，非字符串回落为 `''`（即宿主本地时区）。

### ✅ C39 · 校验错误被放大成内部错误
`src/handlers/schedule.ts:103`

`validateTaskTarget` 只判空不判类型，`target.devices` 为对象/字符串时落到 `for...of` 抛 TypeError，本该是一个清晰的校验失败。
**修复**：先 `Array.isArray` 判定。

### ✅ C40 · 分页 / 数量参数未校验，可拉全量缓存
`src/handlers/schedule.ts:307`、`src/handlers/conversation.ts:46`、`src/handlers/playlist.ts:96`、`:124`

- 调度日志：`Number(query.limit)` 未校验，`NaN` 或负数会让 `getLogs` 返回整个日志缓冲区；
- 对话消息：`limit=abc` / `limit=-5` 返回全部消息缓存，`since` 同样未校验；
- 歌单歌曲：`!playlistId || isNaN()` 放行小数、负数以及 `1e400`→`Infinity`，直接打到 `songloft.playlists.getSongs`；
- 播放接口：`Number.isFinite` 放行小数歌单 id。

**修复**：分别加 `parseLimit`（默认 50 / 上限 200）、`parseMessageLimit`（默认 50 / 上限 500）+ `since` 有限正数校验、正整数校验、`Number.isInteger`（保留负数——那是自建歌单的合成 id）。

### ✅ C41 · 批量开关音源部分写入后 500
`src/handlers/sources_crud.ts:121`

`POST .../batch-toggle` 遇到列表中途的未知 id 时 `setEnabled` 抛错，此时前面的 id 已经落盘且运行时未重载，音源处于半开半关状态。
**修复**：先整体校验所有 id，失败则干净返回 400 且不写入任何内容。

### ✅ C42 · 导入歌曲时歌词被写到错误的歌曲上
`src/bridge/service.ts:640`

`completeImportedSongs` 把无法解析的槽位**过滤掉**再返回，而调用方是**按下标**把返回的宿主歌曲与源歌曲配对来同步歌词的。只要第 n 首没解析出来（宿主只回 `count`，关键词回查又没命中），后面每一首都整体前移一位，于是把**别人的歌词**PUT 到了自己的歌曲上。这是会污染宿主曲库数据的错误。

**修复**：改为返回与 payload 对齐、空位为 `null` 的数组；歌词同步基于对齐后的数组；新增 `compactRemoteSongs()` 在最终返回的 `songs` 里剔除空位。

### ✅ C43 · `bufToString` 对 typed array 返回逗号数字串
`src/music/lx_shim.ts:87`

`lx.utils.buffer.bufToString(buf, enc)` 对 typed array 落到了通用的 `buffer.toString(format)` 分支，而 `Uint8Array.prototype.toString()` 无视编码参数，返回 `"98,111,100,..."`。在没有 Node `Buffer` 的运行时里（`bufferFrom` 此时正是用 `TextEncoder` 产出 typed array），洛雪音源脚本拿到的是静默损坏的文本。
**修复**：先显式匹配 Buffer，typed array 走 hex / `__go_buffer_to_string` / `TextDecoder`。

### ✅ C44 · 网易云歌单详情非异常失败时不回退
`src/music/platforms/providers/wy.ts:116`

只有 `/api/song/detail` **抛异常**时才回退到歌单自带的 `tracks`；当它正常应答但 body 里没有 `songs`（限流、`code: 400`）时 `loadWySongDetails` 返回 `[]`，整页歌单变成空。
**修复**：结果为空时同样触发回退。

### ✅ C45 · 音源批量开关的原子性（跨区域裁决）
`src/handlers/sources_crud.ts:121` ↔ `tests/music/music_handlers.test.ts:234`

新增的前置整体校验让 `tests/music/music_handlers.test.ts` 变红。**裁决：保留修复、修正测试。** 该用例的夹具只种入了 `star`，却断言 batch-toggle `['star','imported']` 返回 200 —— 它能通过只是因为 `setEnabled` 是不会抛错的 mock。真实的 `SourceManager.setEnabled` 对未知 id 抛 `SOURCE_NOT_ENABLED`，映射为 500，此时 `star` 已落盘且运行时未重载。

**处理**：用例改为先真正导入再批量开关；另补一条 `batch toggle rejects unknown ids without writing any of them`，把「400 + 零写入 + 不重载」的新契约固定下来。

### ✅ C46 · 合并歌单时用户最近的排序被丢弃
`src/lx_sync/list_merge.ts:105`

`mergeListData` 的 `locationUpdateTime` 比较写反了（`targetUpdateTime >= sourceUpdateTime` 时跳过重排），结果**较早**重排的一侧胜出，还把那个更旧的时间戳盖了上去 —— 用户最近调整的歌单顺序每次合并都被静默丢弃。
**修复**：改为 `<=`，只有更近重排的一侧才拿到位置。
**测试**：新增用例断言「较新 `locationUpdateTime` 的一侧胜出，且时间戳保留」。

### ✅ C47 · `list_music_add` / `list_music_move` 参数顺序颠倒
`src/lx_sync/list_merge.ts:263`、`:347`

`handleMergeMusic(source, target, type)` 中 `bottom` 会把 **source 放在前面**。两处都传成了 `(新歌, 已有)`，于是默认的 `bottom` 反而**前插**新歌，且重复项会替换掉已有对象与位置。
**修复**：改为 `(已有, 新歌)`，`bottom` 追加、`top` 前插，与洛雪客户端语义一致。

### ✅ C48 · 同列表内移动歌曲会自我撤销
`src/lx_sync/list_merge.ts:347`

除参数顺序外，`list_music_move` 还把**移除前**捕获的 `toList` 拿去合并；`fromId === toId` 时刚被移除的歌又被恢复，整个移动等于没发生。
**修复**：移除之后重新读取目标列表再合并。
**测试**：新增「同列表内移动是重排而非恢复」用例。

### ✅ C49 · 一次创建多个歌单时顺序被反转
`src/lx_sync/list_merge.ts:196`

`list_create` 对每个 `listInfo` 都 splice 到同一个 `position`，客户端一次创建多个列表时顺序整体反转。
**修复**：先收集再整块 splice，去重范围扩展到覆盖本批次。

### ✅ C50 · 畸形 RPC 帧触发致命的 unhandled rejection
`src/lx_sync/message2call.ts:181`

`onMessage` 只检查 `msg.path?.length`，`path` 为字符串的帧会走到对字符串调用 `names.pop()`，在无 catch 的 async 函数里抛出 → unhandled rejection（Node 下可直接终止进程）。
**修复**：校验必须是数组，畸形帧回 `invalid path`，并给分发挂 `.catch`（断连后 handler 内的 `sendMessage` 同样会抛）。

### ✅ C51 · 发送失败后 RPC handler 与 120 秒定时器泄漏
`src/lx_sync/message2call.ts:139`

`sendMessage` 抛错（protocol_ws 在断连时抛 `disconnected`）时 promise 虽然 reject，但 handler 仍留在 `events` 里且定时器已武装；反复重连的客户端每次尝试都留下一个活定时器。
**修复**：发送包在 try 内，失败立即结算 handler，从而清掉定时器与 map 条目。

### ✅ C52 · WebSocket error 事件未接线，对端与 RPC 悬挂
`src/lx_sync/protocol_ws.ts:345`

`InboundWebSocket` 声明了 `onError`，`attachSocket` 却从未接线。在只通过 error 上报断开的宿主上，peer 注册与所有在途 RPC 会一直挂到各自的 120 秒超时。
**修复**：error 走与 close 相同的幂等清理。

### ✅ C53 · 洛雪客户端重连后从广播中消失
`src/lx_sync/protocol_ws.ts:282`、`src/lx_sync/service.ts:188`

`registerListPeer` 会关掉同一 clientId 的旧连接，而旧连接（异步）关闭时又调 `unregisterListPeer(clientId)`，把**新注册的**那个删掉了 —— 一次普通重连之后，在线客户端不在广播列表里，`connectedCount` 显示 0。
**修复**：`unregisterListPeer` 接收 peer 本身，若已不是当前注册的那个则直接 no-op。

### ✅ C54 · 同步配置读-改-写无序列化，密钥轮换被回滚
`src/lx_sync/service.ts:151`

配置读-改-写完全没有序列化：每次同步结束都会跑的 `markSynced` / `setLocalListData` 可能把轮换**之前**的快照写回去，在设备已被吊销之后又把旧密码 / serverId 恢复，UI 上显示的密码配不上任何设备；两个并发的首次 `ensureConfig` 也会各自生成并持久化不同的密码。
**修复**：所有配置读-改-写套上 `withConfigLock` 串行链。

### ✅ C55 · 数字型歌曲 id 导致不同歌曲共用同一稳定键
`src/lx_sync/mapper.ts:131`

`stringField(music.id)` 对数字 id 返回 `''`（第三方洛雪导出以及未校验的 `list_data_overwrite` 载荷里确实存在数字 id），于是不同歌曲塌缩到同一个 `lx:{source}:{title}:{artist}` 键上。
**修复**：改用 `stringishField`。

---

## 三、性能

### ✅ P1 · 语音点歌模糊匹配全库跑编辑距离
`src/indexing/manager.ts:119`、`:490`

`findSongByName` 对「每个歌单 × 每首歌」调 `scoreSongMatch`，绝大多数曲目走不到精确/子串分支，直接落到 O(n·m) 的 Levenshtein 矩阵；同一首歌出现在多个歌单还会重复计算。这条路径在语音指令的用户等待时间内。

**修复**（两处，均为等价优化）：
1. `fuzzyScore` 增加长度差短路——编辑距离不小于两串长度差，`|Δlen| * 2 >= maxLen` 时必然达不到 0.5 相似度阈值，直接返回 0；
2. `findSongByName` 内按「标题+歌手」缓存评分（NUL 分隔，避免 `("a b","c")` 与 `("a","b c")` 撞键）。

**验证**：40 万组随机字符串（含中文 / 拉丁 / emoji / 混合表）+ 13 组边界用例做新旧差分，**mismatch = 0**，35.4% 的组合成功跳过距离矩阵。

### ✅ P2 · 状态条每秒重建数次
`static/js/app.js:191`

`renderStatus()` 挂在每一次 `starlight:state` 上；浏览器播放时 `renderPlayerStatus` 每次 `timeupdate`（约 4 次/秒）都会 `setState`，导致整条状态栏（含其中的按钮）被反复拆建。
**修复**：仅当 patch 触碰状态栏实际渲染的字段时才重建。

### ✅ P3 · 音箱歌单页重复请求同一接口
`static/js/speaker_modules/playlists.js:312`

`loadSpeakerPlaylists` 调了两次 `fetchSongloftPlaylists()`，同一份 `/songloft/playlists` 拉两趟。
**修复**：只取一次并在本地过滤；顺带让汇总计数与实际渲染的过滤结果一致。

### ✅ P4 · 歌单导入回填是 O(n×m)
`src/custom_playlists/service.ts:601`

`patchPlaylistAfterImport` 的宽松标题/歌手兜底匹配在每首歌的 `map` 内部重建 `[...resolvedByKey.values()]` 并线性扫描；1000 首同步约 100 万次 `normalizeKey`。
**修复**：预建 `resolvedByLooseKey`，先插入者优先以保持原 `.find()` 语义。

### ✅ P5 · 认证状态聚合是 N+1 次存储读取
`src/auth/service.ts:396`

`getAllAuthStatus` 循环内每次 `getAuthStatus(acc.id)` 都重读并重新 JSON.parse 整个 accounts blob。
**修复**：抽出 `buildAuthStatus()`，复用单次 `getAccounts()` 结果，输出结构不变。

### ✅ P6 · 每次播放 / TTS 都多打一次 `device_list`
`src/service/service.ts:373`（缓存填充在 `:86`）

`getDeviceIdentity` 只在 `miotDID` 为真时提前返回，于是没有 MIoT DID（或 `hardware` 为空）的音箱，每一次播放和每一次 TTS 都会触发一整轮 `device_list` 请求。
**修复**：两个缓存无条件填充（空串作为「查过且没有」的负标记），守卫改用 `.has()`。

### ✅ P7 · 批量下载时每首歌都拉一次全量曲库
`src/download/service.ts:203`

`findExistingSong` 对批次里每一首都发一次 `songloft.songs.list({ limit: 10000 })`，N 首歌就是 N 次全库拉取。
**修复**：加 30 秒 TTL 的服务级快照（`librarySongs()`，`startBatch` 时重置），并用 `rememberLibrarySong()` 让同批次中先下好的歌仍能被判为「已存在」。一次批次一次列举。

### ✅ P8 · 已经不可能被超越时仍继续探测所有音源
`src/bridge/service.ts:363`

`findPlayableSearchSong` 会把「每个平台 × 3 个候选 × 整条音质阶梯」跑满（每一级都要发一次 URL 探测请求），即使已经拿到不可能被超越的结果。
**修复**：候选同时满足「阶梯顶端音质」且「匹配分达到理论上限」时提前 break；排序是「先音质后分数」且稳定，胜出者可证明不变。

### ✅ P9 · 咪咕歌单详情两个独立请求被串行
`src/music/platforms/providers/mg.ts:177`

`songListDetail` 先 await 歌曲页再 await 歌单信息，两者互不依赖；而 `loadFullSonglist` 每页都会调它。
**修复**：改为 `Promise.all`，每页省一次往返。

### ✅ P10 · 大歌单合并是 O(n²)
`src/lx_sync/list_merge.ts:47`

`handleMergeMusic` 的 `top` 分支对每一项都 `ids.unshift()`。
**修复**：改为 push + 一次 `reverse()`，输出逐字节一致。

### ✅ P11 · `/ah` 限流表为每个请求建条目且从不清理
`src/lx_sync/auth_rate_limit.ts:42`

`isPeerBlocked` 走 `getPeerState`，于是**每一个** `/ah` 请求（包括成功的、以及来自转发头的对端）都会在 map 里留下一条永久记录。
**修复**：改为只读查询并顺带丢弃过期条目，追踪数超过 1024 时做有界清理；新增 `getAuthPeerCount()` 供测试使用。

### ✅ P12 · 请求体 UTF-8 解码走逐字节百分号编码
`src/system/body.ts:8`

`decodeUtf8` 把每个字节拼成 `%xx` 再 `decodeURIComponent`，中间字符串约为请求体的 3 倍；这是所有 POST/PUT 的必经路径。
**修复**：有 `TextDecoder` 时直接用原生解码，无则保留原回退。

---

## 四、测试覆盖补强

### ✅ T1 · 手写 MD5 回退路径此前零覆盖
`src/utils/crypto.ts:19`

无 `crypto.md5` polyfill 时（vitest，以及部分插件运行时）走纯 JS `md5Pure`，酷狗请求签名依赖它，摘要错了该音源静默失效。此前无任何测试。

**动作**：新增 `tests/utils/crypto_md5.test.ts` — RFC 1321 全套向量、55/56/64 字节填充边界、中文、代理对 emoji、以及「有 polyfill 时优先用 polyfill」。**实测实现完全正确**（与 Node `crypto` 逐一比对一致），此项为固化而非修 bug。

---

## 五、待修复

### 📋 R1 · `AccountManager.updateDeviceList` 的读-改-写在存储锁之外
`src/account/manager.ts:150`

**问题**：并发的 `updateDeviceConfig`（经 `ConfigManager.updateDevice` 是原子的）会被它覆盖。
**为何未改**：正确修法需要给 `ConfigManager` 增加「带回调的 mutate」公开 API；只在 `AccountManager` 内部加队列覆盖不到另一个写入方，属于假安全。
**修复思路**：把 `ConfigManager.mutate` 提升为受控的公开方法（或新增 `updateAccountDevices(accountId, fn)`），让设备列表整体替换也走同一把 per-key 锁；改完后补一个「并发 updateDeviceList + updateDeviceConfig 不互相丢失」的测试。

### 📋 R2 · 酷狗非 gcid 歌单分页参数语义存疑，两种解读下都是错的
`src/music/platforms/providers/kg.ts:200`

**问题**：请求 `.../single/${id}-5-${pageSize}.html` 之后又对 `rawList` 按页切片。若 URL 最后一段是**页码**（洛雪音源就是这么用的），那么 `pageSize=100` 时第 1 页实际拉的是第 100 页，歌单显示为空；若它是**每页条数**，那么第 2 页及以后的切片必定为空。两种解读下都不对。

**为何未改**：无法在不打真实接口的情况下判定是哪一种，猜错会让情况更糟。

**修复思路**：用一个已知的酷狗歌单 id 直接请求两次对比 —— `.../single/{id}-5-30.html` 与 `.../single/{id}-5-1.html`，看返回条数是 30 还是「第 1 页的默认条数」。若是页码，则 URL 里传 `page`、不再切片；若是每页条数，则 URL 里传 `pageSize` 并按 `(page-1)*pageSize` 偏移切片。定下来后补一条断言「第 2 页请求的 URL 与第 1 页不同」的测试。

### 📋 R3 · 节假日数据 2027 年为空占位
`src/data/holidays/2027.json`

**问题**：本身是刻意设计（次年未公布时 `scripts/fetch-holidays.mjs` 跳过写入，`tests/release/holidays.test.ts` 也容忍空占位）。但**进入 2027 年后**若没人执行 `npm run fetch:holidays`，`holiday_mode='only_holiday'` 的定时任务会静默永不触发，`exclude_holiday` 也退化为纯 weekday 判断，且没有任何用户可见提示。

**修复思路**：两步。(1) 发布前置：把「当前年份 + 次年数据齐备」纳入 release 流程检查，或加一条定时提醒；(2) 可观测性：`Scheduler` 在匹配 `holiday_mode !== 'ignore'` 的任务却查不到该年任何数据时，打一条**每年只出现一次**的 warn（避免 30 秒 tick 刷屏），并在设置页的定时任务卡片上给出提示。注意不要改变触发语义——数据缺失时继续按现行的「保守不触发」处理。

---

## 六、已评估、决定不改

- **`CustomPlaylistService.create` 并发时可能建出两个宿主歌单** — `tryNativeCreate` 在 store 锁外（store 侧已正确收敛）。把锁扩到覆盖网络 I/O 会让所有歌单写入串行等待一次网络往返，代价更大；代码中已有注释说明该窗口。
- **`relogin` 被 60 秒节流跳过时仍返回 `{state:'success'}`** — 语义含混，但 handlers 与 UI 都按「无需处理」消费，改动属于 API 行为变更而非修 bug。
- **`custom_playlists/service.ts` 中的死方法 `patchPlaylistLink` / `findNativePlaylistIdByName`** — 既有遗留，无害；删除属清理而非修 bug。
- **`music_modules/songlists.js:20` 用 `item?.play_count` 兜底当歌单 id** — 读着像 bug，但 `tests/ui/music_songlists_rankings.test.ts:30` 明确断言了该兜底，是给无 id 字段的音源准备的最后手段。
- **多处 `$('[data-role="…"]').textContent = …` 未判空**（`search.js`、`songlists.js`、`rankings.js`、`songloft_library.js`、`automation_modules/indexing.js`）— 这些 role 在 `static/index.html` 中各只出现一次，且代码路径只在所属面板存在后执行，无可达的空引用。
- **`music_modules/lx_sync.js` 的 5 秒状态轮询不清除** — `bindLxSync` 幂等（`panel.dataset.bound`），轮询体在同步面板不可见时直接 no-op，且该 SPA 无卸载钩子，单个常驻定时器是有意为之。
- **`src/utils/cookie.ts` `buildCookieHeader` 未按 RFC 6265 §5.4 排序**（长 path 优先）— 小米登录涉及的 Cookie 几乎都是 `Path=/`，同 path 下现有实现按创建顺序发送，与浏览器一致；无实际故障证据，不动正在工作的登录链路。
- **`fetchWithRedirects(..., maxRedirects=0)` 在 3xx 时抛 `Too many redirects` 而非返回响应** — 影响 `loginStep1/Step2/exchangeServiceToken/verifyTicket` 与 `qrcode.poll`。这些端点实际都带 `_json=true`（返回 200），且 `src/utils/http.ts` 本轮已定稿。
- **Cookie 头重复合并** — `loginStep1`、`loginStep2WithPassword`、`verifyTicket`、`checkIdentityList`、`qrcode.getQRCode/poll` 手动把 jar 并进 `headers['Cookie']`，`fetchWithRedirects` 内部又并一次。值相同，冗余但无害；为零行为收益改五处调用点不划算。
- **`loginStep3` 优先取*最终*响应的 `Set-Cookie`** — 带 `MAX_REDIRECTS` 时 `serviceToken` 通常设在中间跳，实际会落到 `cookieJar.getValue('serviceToken')`，即注释警告的跨 sid 污染路径。但现有调用方（`auth/service.ts`、`qrcode.ts`、`service.ts`）都为每个 sid 新建 `MinaAuth`，jar 从不跨 sid 复用，故暂不动。
- **`searchAudioId` 在歌词模式下每首歌打印最多 4000 字符的 `rawSongs` + 1200 字符候选** — 热路径日志噪音，但属有意诊断；合适的做法是套用 `isPollDebug()` 开关而非直接删除。
- **`qrcode.poll` 把任何非超时网络错误都映射成终态 `failed`** — 一次瞬时抖动就会杀掉 10 分钟的扫码会话；改分类属行为决策，不是明确的 bug。
- **`getLatestAskFromXiaoai` 重试 3 次且无退避**，每次 401 都重新触发 `onTokenExpired` — 与 Go 原版一致，且 `handleTokenExpired` 已有 60 秒雪崩保护。
- **`searchAudioId` 的 `selectedReason` 恒为 `'first-result'`**，即使实际是精确匹配循环胜出 — 仅日志不准。
- **`submitSMSCode`、`getDeviceHardware` 是死代码** — 未被引用，删除属清理而非修正确性。
- **`message2call.ts` 的 `getData` 组队列竞态** — `handleGroupNextTask` 在等待中的续体重新置位之前就清了 `handling`，该窗口内到达的调用会绕过队列。与上游 lx-music 一致，且只有同组并发调用才可达，同步流程不会出现。
- **`broadcastListAction` 逐个 await 对端**（`service.ts:206`）— 一台无响应设备会把发起端的 `onListSyncAction` 拖到 120 秒 RPC 超时。确有活性代价，但改成 fire-and-forget 会改变投递保证，先记录不猜。
- **`withSyncLock` 跨客户端 RPC 持有**（`protocol_ws.ts:322`）— 一个挂死的客户端会在 RPC 超时内阻塞其它设备的列表写入。这是有意的存储保护，要改需要更细粒度的锁。
- **`LxDeviceStore.save` 超过 100 台抛 `max devices`**（`devices.ts:70`）— 一旦满了就再也配不了新设备。按最久未连接淘汰会更好，但这是刻意上限，未经要求改动吊销行为风险更大。
- **`pkcs7Unpad` 不校验填充字节**（`crypto_lx.ts:286`）— 只检查长度字节。此处无实际影响（明文随后要与 `authMsg`/`msgConnect` 做前缀比对），且不是暴露给填充预言机的路径。
- **`decodeData` 为量长度而复制一份完整 UTF-8**（`crypto_lx.ts:627`）— protocol_ws 已在前面拒绝 >3MB 的帧，浪费有界且很小。
- **`applyListAction` 每个增量动作都重映射并重写整个歌单存储**（`service.ts:324`）— 大曲库下确实昂贵，但那是存储架构问题，不是 bug。
- **遗留 handler 用 HTTP 200 + `{success:false}` 表达校验错误**（`playlist.ts`、`device.ts`、`auth.ts`、`schedule.ts`、`voice_command.ts`、`conversation.ts`）— 不符合 REST 惯例，但这是整个 `/api/miot` 家族一致的契约，前端读的是 `success` 而不是状态码。改动属破坏性 API 变更。
- **`DownloadService.getBatchProgress()` 在 `done: true` 时仍返回 `active: true`** — 看着像 bug，但 `static/js/music_modules/downloads.js:53` 用的是 `progress?.active && !progress.done`，即 `active` 表示「存在一个批次」，既有测试也是这么编码的。
- **`/player/status` 绕过 `getOrFetchDeviceStatus`** 而 `/mina/status` 用它，两个 5 秒轮询的端点可能各自打一次小米云。改走在途去重会影响 `volumeLockedUntil` 的处理，只记录不改。
- **`SongloftImportJobs.get` 对不存在的 job id 抛 400** — 应为 404，但 `ERROR_CODES` 里没有 `NOT_FOUND`。
- **`'task_' + Date.now()` 的任务 id 同毫秒内可能冲突** — 真实但概率极低，且该 id 格式在 `src/types.ts` 中有文档约定。
- **`music.ts` 的 `page()` 没有上限**（`page_size` 有，上限 100）— 它转发给外部音源而非宿主，页码离谱只会拿到空结果。
- **`findBestSongloftSongMatch` 把 `isLocal` 排在 `score` 之前** — 弱模糊命中的本地歌（50 分）会压过精确命中的远程歌（100 分）。这看起来正是 `f0de4d7 "feat reuse local songs before playback"` 的意图，且已有测试锁定了本地优先，改排序键属产品决策。
- **`SOURCE_NAME_TO_PLATFORM` / `modeMap` / `COMMAND_PRIORITY` 是可经原型链解析的普通对象字面量** — 例如 LLM 给出 `"constructor"` 会拿到一个函数。真实但对中文语音/LLM 输入不可达，且不会抛错。
- **`src/music/lx_shim.ts:341` 在 `setTimeout` 不可用时让带 `timeout` 的请求直接失败** — 看着像 bug，但已有测试显式断言了该行为，是有意为之。
- **`src/music/platforms/providers/kw.ts:164` 每首歌先发一次 `artistpicserver` 再看行内封面** — 每页最多 `pageSize` 个并发请求，但已有测试覆盖该回退，属有意设计。
- **`completeImportedSongs` / `playSonglistOnSpeaker` 的 N 次串行宿主往返** — 成本真实，但批量化需要宿主提供多键查询接口，而全部并发只是把负载转移到宿主。
- **`src/data/holidays/2027.json` 为空占位** — 这是刻意设计：`scripts/fetch-holidays.mjs` 对「次年尚未公布」返回 404 时跳过写入，`tests/release/holidays.test.ts` 也显式容忍空的未来年份。**但需留意**：进入 2027 年后若未执行 `npm run fetch:holidays`，`holiday_mode='only_holiday'` 的定时任务会静默永不触发。属数据时效问题，不是代码缺陷。

---

## 七、验证

| | 审查前 | 审查后 |
|---|---|---|
| `npm run typecheck` | 通过 | 通过 |
| 测试文件 | 100 | 110 |
| 测试用例 | 632 | 712 |

新增用例均已确认「修复前失败、修复后通过」。此外做了两项独立验证：

- **纯 JS MD5**（`src/utils/crypto.ts`）— 与 Node `crypto` 逐一比对 RFC 1321 全套向量、填充边界、中文与代理对，实现正确，补测试固化。
- **模糊评分短路优化**（P1）— 40 万组随机字符串 + 13 组边界用例做新旧差分，mismatch = 0。
