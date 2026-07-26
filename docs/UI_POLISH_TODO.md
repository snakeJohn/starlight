# 前端美化 · 进度与待办

> **第二轮进行中**（密度 / 音箱页 IA / 列表 / 封面清晰度）。
> 每个工作流有独立的进度文件，避免并发写同一份文档互相覆盖：
>
> | 工作流 | 负责人 | 进度文件 |
> |---|---|---|
> | 音箱页信息架构重排 | agent A | `docs/ui-progress/speaker-ia.md` |
> | 全局密度与呼吸感 | agent B | `docs/ui-progress/density.md` |
> | 列表与控件密度 | agent C | `docs/ui-progress/lists.md` |
> | 五平台封面高清化 | agent D | `docs/ui-progress/covers.md` |
> | 合并 · 验证 · 发布 | 主 agent | 本文件第 8 节 |
>
> 规则：各自只写自己那一份；主 agent 负责合并、跨流冲突裁决与最终验证。

---

## 8. 第二轮 · 主 agent 进度

**触发**：用户反馈「UI 感觉很拥挤」＋「音箱菜单下五个模块东一块西一块」＋「五平台封面很模糊」。

- ✅ 定位音箱页根因：两行各自是独立的 2 列网格，每行矮卡片旁边留下大片空洞，形成两块对角空白（索引下方约 700px）
- ✅ 预览服务支持 `polish2-*.css` 片段自动拼接，四个 agent 可并行且互不抢文件
- ✅ 约束分工，防止上一轮那种层叠打架：B 管容器/卡片/表单节奏，C 管行内/列表/分页，A 只管音箱页五块的网格摆放，D 只动 `src/music/platforms/providers/`
### 第二轮各流结果

**A · 音箱页 IA（已完成）** — 详见 `docs/ui-progress/speaker-ia.md`
改为**单一页面级网格**：播放控制+歌单列表（最高，~1285px）独占左列并跨全高；账号 → 设备+设备设置 → 索引 三张矮卡片叠成右栏（~1390px），两列几乎同时收尾；语音记录作为整幅页脚（它的行本来就是 `auto-fit minmax(280px,1fr)`，越宽越好，且是唯一会无限增长的模块）。DOM 顺序未变，手机端堆叠顺序不受影响。
- 最大空洞 **940px → 101px**，次空洞 204px → 无
- `#tab-speaker` 高度 **2080px → 1812px**
- 单列折叠点设在 1180px（不是全站的 980px），因为右栏低于 ~450px 时设备表单会换行难看

**B · 全局密度（已完成）** — 详见 `docs/ui-progress/density.md`
定义 4px 基数的六级刻度 `--space-1..6`，并派生**随断点下移一档**的语义别名（`--card-pad`/`--card-gap`/`--section-gap`/`--field-gap`/`--page-pad`），比例 5:2:1 —— 组间宽松、组内紧凑、附属说明最紧。
- 卡片内边距 16 → **20px**；卡片间距 14 → **20px**；标题到正文 12(发现页 10) → **16px 统一**
- 标签→控件 5~6 → **8px**；控件→说明 6 → **4px**（刻意更紧，这才是层级）
- 字距 −0.011em → −0.042px：**这是「拥挤感」的主因**，负字距把 CJK 字内间距也压掉了；行高只在正文语境提到 1.6，UI 行保持 1.5
- 滚动代价：桌面搜索/发现/歌单 **0%**，设置 +5.0%，音箱 +6.7%；移动端 +2.7%~+7.7%
- 顺手修掉一个**既有**移动端溢出：`#tab-settings .automation-layout` 的 id 选择器压过 ≤760px 的 `.two-column{1fr}`，390px 下语音口令被挤成 ~90px 竖排、定时任务被推出屏幕

**D · 五平台封面（已完成）** — 详见 `docs/ui-progress/covers.md`
全部为**纯 URL 重写，零额外请求**，每个数字都来自真实抓取后解码图片头。

| 平台 | 改前实测 | 改后实测 |
|---|---|---|
| 酷我 kw | **120×120**（~10 KB） | **800×800** |
| 酷狗 kg | 400×400 | **800×800** |
| QQ tx | 500×500 | **800×800** |
| 咪咕 mg | 800×800（已最大） | 800×800，榜单改按 `imgSizeType` 取最大 |
| 网易云 wy | 500~3648（本就是原图） | 不变，仅剥掉会缩小的 `?param=` |

- **最大元凶是 kw**：`normalizeKwExternalCoverUrl` 在**主动降级** —— 明明请求了 `size=1000`，却把所有 artistpicserver URL 重写成 `/120/`；而排行榜没有封面字段，全部走这条路径
- 第二个真 bug：kg 的 `{size}` 占位符**从未被替换**，歌单封面直接把字面量 `{size}` 发出去（恰好因酷狗兜底渲染返回 400×400 才没暴露）
- **与上游 LX Music 的分歧都有实测支撑**：上游把 tx 钉在 500、kg 钉在 240，实测均偏软，800 两边都确认可用；上游 mg 的 `getSongPic` 是**每首歌一次额外请求**，按 N+1 拒绝采用
- 兜底：一律「只升不降」比较；QQ 只用白名单尺寸（实测 `1000x1000` **404**）；所有正则前缀锚定，未知形态原样放行

**C · 列表与控件密度（已完成）** — 详见 `docs/ui-progress/lists.md`
消费 B 的刻度（`var(--space-N, fallback)`，兜底值与 B 公布值一致，故独立也正确）。
- 搜索行高 80.9 → **96.8px**，行距 88.9 → **108.8px**；行内边距 10/12 → **14/16px**；封面 44 → **48px**
- 列表滚动容器上限 62vh(558px) → **72vh(648px)** —— 刻意上调：行变高后若不放宽，可见行数会从 6.3 掉到 5.4；调整后为 6.0，**滚动到列表后的可见行数基本持平**
- 移动端行高 129.9 → 144.8px，两个宽度均无横向溢出
- 顺手修掉一个**既有**缺陷：`#tab-discover .media-row > .media-artwork`（1 id + 2 class）权重压过 `.ranking-ordinal`（1 id + 1 class），榜单序号块被迫套用 44px 封面尺寸并溢出自己的 30px 轨道
- `.batch-actions` 横向滚动加了**方向感知**的渐隐提示（只在还能滑动的一侧出现）

- ✅ 合并三份 `polish2-*.css` → `style.css`（括号平衡 853/853，164.9 KB）
- ✅ 跨流复核：合并后移动端仍为 390px 单列、无横向溢出（上一轮 `.app-shell` 事故未重演）
- ✅ **修掉一处跨流不一致**：底部播放条是封面色、页内「播放控制」卡却仍是主题紫 —— 同一首歌两处表示不同色。`--accent` 重绑范围补上 `.speaker-player-panel`
- ✅ 修掉 A 报告的测试守卫失效：`static_layout.test.ts` 用被删掉的 wrapper 当切片终点，`indexOf` 返回 −1 后断言仍通过但**不再证明任何事**。改为结构无关边界并加守卫，且**实测破坏后确实会失败**
- ✅ typecheck 通过 · **720 用例全绿**（较上轮 +8，封面测试）· build 成功
- 📋 **提交**（尚未提交）

### 第二轮包体
**630.7 KB**（第一轮 620.4 KB，+10.3 KB —— 新增密度/列表/IA 三份 CSS）。
⚠️ 与第一轮不同：本轮 **`entryHash` 变了**（`585b51ed…`），因为封面修复动了 `src/music/platforms/providers/`。**不再是纯前端改动**，回滚需连同后端一起。

---

分支 `fix/rebuild-post-grok`。基线截图取自真实测试环境 `http://192.168.31.63:18191`（1440×900 与 390×844）。

**状态图例**：`✅ 已完成并验证` · `🔀 已完成待合并` · `🚧 进行中` · `📋 待办` · `⏸ 已评估、需决策后再动`

**更新规则**：负责人各自更新自己那一节；跨节的合并与最终验证由主 agent 统一做。子 agent 完成后必须回填自己那一节的状态。

---

## 0. 当前总状态

| 项 | 值 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| 测试 | ✅ 712 全通过 |
| `npm run build` | ✅ 成功 |
| 插件包大小 | **620.4 KB**（美化前 684.1 KB，**−9.3%**） |
| CSS 片段合并 | ✅ 三份全部并入 `style.css`（133.7 KB，括号平衡），暂存文件已删除 |

包体构成（压缩后）：`main.jsc` 537.4 KB (87%) · `app.bundle.js` 39.4 KB · `style.css` 25.4 KB · `index.html` 9.1 KB · `icon.webp` 7.6 KB。
美化新增的 CSS 使样式表从 14.0 → 25.4 KB（+11.4 KB），被图标优化的 −78 KB 覆盖有余。

---

## 1. 播放器重做（负责人：主 agent）

- ✅ 播放条改为「贴顶通栏进度 + 左信息 / 中传输 / 右目标与次要操作」三栏
- ✅ 时间移入标题下方，与当前歌词同行
- ✅ 高度：桌面 120→**96px**，移动端 200→**128px**（控制不再换行）
- ✅ 封面主色采样写入 `--player-accent`，在播放器子树内重绑 `--accent`（既有 `!important` 规则自动跟随，不外溢到其它页面 —— 已用 computed style 验证）
- ✅ 修掉自己引入的 bug：色相是角度，线性平均会让跨 0°/360° 的红色封面算成蓝色；改为向量圆均值
- ✅ 全屏播放器：封面主色氛围渐变、当前歌词行高亮、内容限宽 1040px 居中
- 📋 全屏播放器**空闲态**（无播放内容时）大片留白未处理
- ⏸ 播放条右侧「模式」与「刷新」都是圆形箭头图标，容易混淆 —— speaker agent 已把刷新改成描边次要按钮做区分，是否进一步换图标待定

## 2. 音箱页（负责人：speaker agent）

CSS 位于 `scratchpad/polish-speaker.css`（44/44 括号平衡，全部作用域限定在 `#tab-speaker`），**纯 CSS，未改 JS/HTML**。

- 🔀 保存设备错位：根因是 `.speaker-device-actions` 在约 171px 列里用 `minmax(min(100%,112px),1fr)`，两个按钮需 232px 于是折行，`align-items:end` 再把它顶到选择框上一行。改为不折行的 flex 行
- 🔀 二维码空闲态收为 56px 虚线条，并隐藏空的 `[data-role="qr-link"]`（它撑出了一整个幽灵网格行）
- 🔀 卡片头统一 44px（原本以状态文字结尾是 34px、以按钮结尾是 44px，卡片之间对不齐）
- 🔀 状态文字复用主 agent 的计数徽标样式
- 🔀 删除账号改为静默 + hover 变 `var(--danger)`，与「已选/重新登录」形成三档权重
- 🔀 移动端总高 3953→3655px（−300px），无删减
- 🔀 账号卡不再被拉伸对齐到更高的设备卡（原本留 ~160px 空白）
- 📋 **待主 agent 应用的 HTML 改动**：把 `speaker-player-refresh` 按钮移进 `.playback-controls` 行（agent 已给出精确 before/after，且确认 `static_layout.test.ts:111` 仍通过）；应用后需删掉其 CSS 里 `#tab-speaker .speaker-player-panel > .inline-actions` 一段
- ⏸ 桌面端右列「索引」下方约 700px 空档 —— 需把「语音记录」移进 `.speaker-side-stack`，属结构改动，待决策
- ⏸ 「正在播放：智能音箱」与目标切换器的选中态重复 —— 属 `playback_target.js` 渲染逻辑，非样式问题

## 3. 搜索 / 发现 / 歌单页（负责人：music agent）

- ✅ 搜索按钮回到与输入框同一行（根因：`.wide-field` 跨两列吃掉了尾部 `auto` 列）
- ✅ 结果计数改为徽标（原本是贴着「清空」按钮的裸数字，像渲染故障）
- ✅ 批量操作分主次：全选/取消选择静默化
- 🚧 歌曲行层级、空状态、分页栏分组、卡片间距、移动端换行 —— agent 进行中
- 📋 `polish-music.css` 尚未产出

## 4. 外壳与设置页（负责人：shell agent · 已完成）

CSS 在 `scratchpad/polish-shell.css`（16.6 KB）；另改了 `app.js`、`diagnostics.js`、`automation_modules/{ai_config,schedules,voice_commands}.js`。

- 🔀 状态条：连接状态改为**第一个** chip 并入同一行（原本在独立的右对齐 `.status-side` 里，永远贴着右边缘），chip 由实心药丸降为细线分隔的元信息行，状态用 7px 圆点表达
- 🔀 修正 `音源 2 / 1 启用` 的总数/启用数顺序颠倒 → `1/2 启用`
- 🔀 **侧栏底部提示原本是不可见的**：`.side-rail` 为 `height:100vh`，而外壳有 `--global-player-height` 的下内边距，最后一行被固定播放条盖住。改为 `calc(100vh - var(--global-player-height))`
- 🔀 侧栏 240→208px，活动项加 3px 强调条
- 🔀 页面标题右侧控件改为与 h1 底对齐（原本对两行块垂直居中，导致 28px 药丸/44px 按钮/无控件三种页面各自高度不同）
- 🔀 设置子导航改为下划线 tab，活动态在字重/颜色/指示条三个维度同时区分（发现页共用该组件，一并变化，是有意为之）
- 🔀 **发现的真 bug**：`.lx-sync-actions` 同时带 `row-actions` 和 `form-actions`，而 `.row-actions{justify-content:flex-end}` 在 style.css 中更靠后，导致洛雪面板的操作行右对齐、AI 面板同类行左对齐。已统一左对齐
- 🔀 诊断日志行重写：状态改为带圆点的徽章 + 3px 状态色条，右侧五行元信息收为一行，行高约减半
- 🔀 自动化定时任务列 `minmax(220px,0.34fr)` → `minmax(320px,0.46fr)`（十个字段挤在 ~280px 里）
- ✅ 自测中触发的 `automation_ai_config_module.test.ts` 失败已由其自行修复（vitest 的 DOM 替身没有 `dataset`，加了守卫）

## 4b. 深色主题信号错配（负责人：主 agent · 已修复）

shell agent 发现、我确认并修复的**全站级**问题：

- 宿主用 `html[data-theme="dark"]` 切换主题，而 `style.css` 只在 `@media (prefers-color-scheme: dark)` 里重新映射派生 token
- 宿主 `common.css` 会按主题重映射 `--md-surface`，但**没有定义 `--md-background`**，因此 `--host-background` 一直停在浅色兜底值 `#f3f5f8`，`--surface-control` 混出浅灰 —— 深色宿主 + 浅色系统时，深色文字压在浅色控件上
- ✅ 修复：`html[data-theme="dark"]` 作为权威信号单独成组；媒体查询收窄为 `html:not([data-theme])`，这样**明确指定浅色的宿主在深色系统下不会被误翻**
- ✅ 已验证：浅色 `bg #f3f5f8 / text #1C1B1F`，深色 `bg #0b0f14 / text #E6E1E5`

## 5. 体积优化（负责人：主 agent）

- ✅ `static/icon.png` 256×256 PNG 86.3 KB → `icon.webp` **7.7 KB**
  - 该图无全透明像素、10662 种颜色，属渐变图 —— 调色板量化无效，PNG 天然压不动（256px 重编码反而 89.8 KB）
  - PNG 在 zip 内几乎不再压缩，所以它实打实占了原包的 13%
  - 兼容性无新增要求：样式表已依赖 `color-mix()`（Chrome 111+），远高于 WebP（Chrome 32+）
  - 已同步更新 `index.html` favicon、`style.css` `.brand-mark`、以及 2 条断言
- **包体：686.9 → 609.0 KB（−11.3%）**
- ⏸ `main.jsc` 占压缩后 78%（537 KB），是唯一剩下的大头。需要 esbuild 层面做 treeshaking/分包评估，超出本次美化范围

---

## 5b. 跨 agent 回归（music agent 发现 · 主 agent 已修复）

shell agent 的 `.app-shell { grid-template-columns: 208px minmax(0,1fr) }` **无条件声明**，位置在 `@media (max-width:760px)` 单列规则之后，因此在所有宽度胜出。移动端侧栏虽已 `display:none`，208px 轨道仍被保留，工作区被压到 184px —— **所有标签页都受影响**。

同一文件里还有第二处：`@media (max-width:980px)` 的 `184px` 也排在 760px 规则之后，390px 下两条都匹配，最终落在 184px。

- ✅ 两处均加下界：`@media (min-width: 761px)` 与 `@media (min-width:761px) and (max-width:980px)`
- ✅ 已实测 390px：`grid-template-columns: 390px`、工作区 390px、`scrollWidth` 无溢出

## 6. 收尾清单（主 agent）

- ✅ 合并三份 CSS 进 `static/css/style.css`（括号平衡 744/744）
- ✅ 应用 speaker agent 的 HTML 改动（刷新按钮并入传输行），并把其失效的 `.inline-actions` 选择器重定向到 `[data-action="speaker-player-refresh"]`，保住「次要工具按钮」的视觉区分
- ✅ 删除歌单页重复的「刷新」按钮（`.panel-heading` 与 `.section-bar` 各一个）
- ✅ `automation_ai_config_module.test.ts` 由 shell agent 自行修复
- ✅ 重跑：typecheck 通过 · **712 用例全绿** · build 成功
- ✅ 重新截图复核（桌面五页 + 全屏播放器 + 移动端），三份 CSS 无相互覆盖
- ✅ 深色主题：token 切换已实测（见 4b）
- 📋 **提交**（尚未提交）

## 7. 未完成 / 待决策

- ✅ **移动端 music 页面已重新验证**（390×844，回归修复后，带真实数据）：
  - 搜索：加载 20 条真实结果，歌曲行卡片化（勾选框 / 封面 / 标题·歌手·专辑 / 平台 + 音质徽标 + 时长），操作按钮独立成行；分页为「上一页 | 第 1/166 页 | 下一页」分段控件 + 下方「指定页 + 跳转」
  - 发现：子导航下划线 tab、表单纵向堆叠、加载榜单为整宽主按钮；错误空状态（红色 `!` 徽章）渲染正常
  - 歌单：卡片布局、名称+新建同行、空状态 ♪ 徽章
  - 三页 `scrollWidth` 均等于 390，**无文档级横向溢出**
  - 唯一超出视口的元素是 `.batch-actions` 内的批量按钮，但该容器 `overflow-x: auto`（视口 332px / 内容 610px），是**有意的横向滚动条**，非缺陷
- ⏸ 音箱页桌面右列「索引」下方约 700px 空档（需把语音记录移进 `.speaker-side-stack`，属结构调整）
- ⏸ 全屏播放器空闲态大片留白
- ⏸ 播放条右侧「模式」与「刷新」同为圆形箭头图标（音箱页已用描边区分，播放条未处理）
- ⏸ `lx_sync.js` 的 `setStatus()` 把同一时间戳同时写进 `[data-role="lx-sync-status"]` 和 `[data-role="lx-sync-message"]`，洛雪面板上「上次同步 …」重复出现两次，并覆盖掉 `index.html:544` 的说明文案（shell agent 发现，属 music agent 文件范围，两边都没动）
- ⏸ `main.jsc` 占压缩后 87%，是体积唯一大头，需 esbuild 层面评估，超出本次范围
- 📋 **网易云封面带宽**：wy 的 `picUrl` 是原图，实测存在 **3648×3648 / 595 KB** 的封面，而列表里只显示 44px —— 20 行约 12 MB。
  **为何本轮未改**：正确做法是按显示尺寸追加 `?param=WxH`（网易云的 param 只缩不放，可当上限用），但我拿不到真实 netease 封面 URL 做实测（宿主 `/api/music/search` 该路径 404），而本轮的标准是「实测优先于推断」，不应自己破例塞一个未验证的改动。
  **修复思路**：在 `wy.ts` 的 `wyOriginalCover` 改为 `wyCappedCover` —— 先剥掉已有 `param`，再追加 `?param=800y800`。落地前必须先抓一个真实 `p*.music.126.net` 封面，验证 (a) 3648 原图会被压到 800，(b) 500 原图不会被拉伸、仍返回 500。两条都满足才算安全。
- ⏸ **既有问题（非本次回归）**：发现页「加载榜单」返回 `source_id is required`。已核对 `rankings.js` 的请求构造改前改后**逐字节相同**（`git diff` 只动了空状态渲染），且 `[data-role="ranking-platform"]` 实测 `value="kw"` 非空。属后端契约或音源能力问题，与美化无关，但值得单独排查
