# 全局密度与呼吸感 · 进度

**目标**：上一轮压得过紧（卡片头统一 44px、移动端砍 300px、区块内边距收缩），现在显得局促。恢复呼吸感但不破坏已做好的对齐。

**产出文件**：`…\scratchpad\polish2-density.css`（只写这一个文件，未改 `static/css/style.css` 与 `static/index.html`）

## 间距刻度

定义在 `:root`，其它 agent 可直接消费。4px 基准，六级：

| token | 值 | 用途 |
| --- | --- | --- |
| `--space-1` | `4px` | 附着关系：控件 → 其帮助文本、圆点 → 标签 |
| `--space-2` | `8px` | 组内：标签 → 控件 |
| `--space-3` | `12px` | 组内横向：相邻字段列、卡内工具条内边距 |
| `--space-4` | `16px` | 组与组：区块标题 → 正文、控件网格行距 |
| `--space-5` | `20px` | 卡片内边距、卡片之间、字段之间 |
| `--space-6` | `28px` | 页面级：`.tab-panel` 左右与底部留白 |

语义别名（在 ≤760px 断点整体降一档，消费别名即可自动适配）：

| token | 桌面 | 移动 (≤760px) | 含义 |
| --- | --- | --- | --- |
| `--card-pad-x` / `--card-pad-y` | `20px` (space-5) | `16px` (space-4) | `.surface-section` 内边距 |
| `--card-gap` | `20px` (space-5) | `16px` (space-4) | 卡片之间 |
| `--section-gap` | `16px` (space-4) | `12px` (space-3) | 区块标题 → 正文 |
| `--field-gap` | `20px` (space-5) | `16px` (space-4) | 字段 → 字段（`.form-stack`） |
| `--gap-label` | `8px` (space-2) | `8px` | 标签 → 控件 |
| `--gap-help` | `4px` (space-1) | `4px` | 控件 → 帮助文本 |
| `--page-pad-x` | `28px` (space-6) | `12px` (space-3) | `.tab-panel` 左右 |
| `--page-pad-y` | `20px` (space-5) | `16px` (space-4) | `.tab-panel` 顶部 |

节奏原则：**组间宽 20px ／组内 8px ／附属 4px**，比例 5:2:1。移动端整体退到 space-3/space-4 两档。

## 状态

- ✅ 定下 `--space-1..6` 与语义别名（其它 agent 可消费）
- ✅ 卡片：`.surface-section` 内边距与卡间距
- ✅ 页面框架：`.tab-panel` 内边距
- ✅ 页头：`.panel-heading` / `.eyebrow` / `.page-subnav` 竖向节奏
- ✅ 区块：`.section-bar` → 正文距离（含 `#tab-speaker` / `#tab-discover` 的两处更紧的覆盖，统一回一个数）
- ✅ 表单：`label/.field-row` 标签→控件→帮助文本，`.form-stack` / `.control-grid` / `.schedule-settings-form`
- ✅ 排版：`body` 字距 -0.011em → -0.003em；行高拆开（UI 1.5 / 正文类 1.6）
- ✅ 顺手修掉移动端 `自动化` 分栏溢出（见下）
- ✅ `npx vitest run tests/ui` 33 files / 179 tests 全绿
- ✅ 桌面 1440×900 + 移动 390×844 截图复核（search / discover / playlists / speaker / settings 五个 tab，含 settings 的 5 个子页）

## 关键测量（改前 → 改后）

桌面 1440×900：

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 卡片内边距 `.surface-section` | `16px` | `20px` |
| 卡片间距（相邻卡实测） | `14px` | `20px` |
| 区块标题 → 正文（`.section-bar` 下缘 → 首个子元素） | `12px`（发现页 `10px`） | `16px`（统一） |
| 页头 → 内容 | `16px` | `20px` |
| 标签 → 控件 | `5–6px` | `8px` |
| 控件 → 帮助文本 | `6px` | `4px`（刻意收紧，拉开层级） |
| 字段 → 字段 `.form-stack` | `14 / 18px` | `20px` |
| `.control-grid` 间距 | `10px` | `16px / 12px`（行 / 列） |
| `.tab-panel` 内边距 | `18px 20px 28px` | `20px 28px 28px` |
| `body` 行高 / 字距 | `20.3px` / `-0.154px` | `21px` / `-0.042px` |

移动 390×844：

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 卡片内边距（`#tab-speaker`） | `14px 12px` | `16px` |
| 卡片间距（`#tab-speaker`） | `10px` | `16px` |
| 区块标题 → 正文 | `10–12px` | `12px`（统一） |
| 页头 → 内容 | `12px` | `16px` |
| `.tab-panel` 内边距 | `14px 12px` | `16px 12px 20px`（底部原本让末卡压在 tab bar 下） |

滚动预算（`document.scrollHeight`，改前 → 改后）：

| 页面 | 桌面 | 移动 |
| --- | --- | --- |
| 搜索 | 900 → 900（0%） | 1039 → 1086（+4.5%） |
| 发现 | 900 → 900（0%） | 972 → 1027（+5.7%） |
| 歌单 | 900 → 900（0%） | 1027 → 1076（+4.8%） |
| 设置 | 900 → 945（+5.0%） | 1076 → 1105（+2.7%） |
| 音箱 | 1830 → 1952（+6.7%） | 3295 → 3550（+7.7%） |

桌面三个常用页仍是一屏内，零增长；最长的音箱页 +7.7%（约 1/4 屏），是刻意把上一轮砍掉的卡片留白还回去。

## 顺手修掉的既有缺陷

移动端 `设置 › 自动化` 分栏溢出：`自动化` 容器是 `.settings-stack.two-column.automation-layout`，而 `#tab-settings .automation-layout{grid-template-columns: … minmax(320px,.46fr)}`（id 限定）压过了同一 media query 里的 `.two-column{1fr}`。390px 下 320px 最小宽把「语音口令」挤成约 90px 的竖排文字，「定时任务」被推出屏幕。已在 ≤760px 内改回单列。**这不是本轮改动引入的**。

## 未完成 / 待决策

- `#tab-speaker` 的网格布局由第三个 agent 重构：本轮只动该页 `.surface-section` / `.section-bar` / 列表分隔线的内外边距，未动 `grid-template-columns`、`.device-selection-grid` 的 gap、`.speaker-device-actions`。
- 歌曲行 / `.list-stack` 条目内边距 / `.media-row` / `.song-row` / `.pagination-bar` / `.batch-actions` / `.row-actions` / 抽屉均属列表 agent，本轮未碰。
- 本文件的 CSS **零颜色声明**（`grep` 校验 0 处），因此明暗主题按定义都不受影响。
