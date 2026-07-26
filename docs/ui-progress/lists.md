# 列表与控件密度 · 进度

**目标**：上一轮把行压得过紧（桌面搜索行实测 80.9px、行距 88.9px、行内三层文字间距 3px），整体读起来没有空气。恢复行内与行间呼吸感，但列表仍要可扫读（目标 8~9 行 / 900px 视口，不是 3 行）。

**产出文件**：原为 `…\scratchpad\polish2-lists.css`（唯一 CSS 落点）。本轮结束时协调方已把三个 agent 的
polish 层合并进 `static/css/style.css` 并删除 scratchpad 副本 —— 后续列表改动请直接改 style.css 里
`row rhythm tokens` / `Komarov` 那几段。全程未改 `static/index.html`、`renderers.js`、`pagination.js`。

## 状态

- ✅ 基线实测（桌面 1440×900 真实搜索结果 + 排行榜 + 歌单广场，移动 390×844）
- ✅ 行节奏：`--row-pad-x/y`、`--row-art`、`--row-gap`、`.list-stack` gap、行内三层文字间距
- ✅ 行内操作按钮 + 堆叠布局的分隔带
- ✅ 排行榜榜单行：修掉序号方块的选择器权重问题（详见下）
- ✅ 分页条 / `.batch-actions` / `.list-actions-bar` / `.inline-actions`
- ✅ 空状态、`.list-scroll` 滚动窗口高度
- ✅ 音箱歌曲抽屉行（原 `height: 40px` 硬钉死）
- ✅ 移动端 `.batch-actions` 横滑提示（Komarov scroll shadow，只在还能滑的一侧显示）
- ✅ `npx vitest run tests/ui` 33 files / 179 tests 全绿
- ✅ 明暗两种主题复核（用 Material token 覆盖模拟深色宿主）
- ✅ 无横向溢出：`documentElement.scrollWidth == clientWidth`（1440 / 390 均是）
- ✅ 打包：`dist/starlight.jsplugin.zip`（645,835 B），产物内 `static/css/style.<hash>.css` 已逐条校验
  含三个 agent 的全部规则（列表 / 密度 `--space-1..6` / 音箱 IA）

## 关键测量（改前 → 改后）

改前 = 同一次运行内用 CDP 只给本浏览器换回未修改的 `style.css`，不干扰共享预览。

桌面 1440×900：

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 搜索行高 | `80.9px` | `96.8px` |
| 搜索行距（行 + 间隙） | `88.9px` | `108.8px` |
| 900px 视口可见行数（按行距） | `10.1` | `8.3` |
| 结果滚动窗口内可见行数 | `558 / 88.9 = 6.3` | `648 / 108.8 = 6.0` |
| 行内边距 | `10px 12px` | `14px 16px` |
| 列表行间距 `.list-stack` gap | `8px` | `12px` |
| 封面 `--row-art` | `44px` | `48px` |
| 行内三层文字间距 | `3px` | `5px` |
| 行内按钮高度 / 间距 | `30px` / `6px` | `32px` / `8px` |
| `.list-scroll` 上限 | `min(62vh,680px)` = `558px` | `min(72vh,760px)` = `648px` |
| 批量操作条高度 | `45px` | `47px` |
| 分页条高度 | `57px` | `61px` |
| 歌单广场行 高 / 行距 | `66 / 74px` | `78 / 90px` |
| 排行榜榜单行 高 / 行距 | `62 / 70px` | `60 / 72px` |
| 榜单序号方块 | `44×44`（挤在 30px 轨道里） | `36×36`（36px 轨道） |
| 排行榜歌曲行 高 / 行距 | `80.9 / 88.9px` | `96.8 / 108.8px` |

移动 390×844：

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 搜索行高 | `129.9px` | `144.8px` |
| 搜索行距 | `137.9px` | `154.8px` |
| 900px 视口可见行数（按行距） | `6.5` | `5.8` |
| 行内边距 | `10px 11px` | `12px 13px` |
| 列表行间距 | `8px` | `10px` |
| 封面 `--row-art` | `42px` | `44px` |
| `.list-scroll` 上限 | `523px` | `608px` |
| 分页条高度 | `99px` | `107px` |

## 空间刻度

消费 density agent 在 `polish2-density.css` `:root` 定义的 `--space-1..6`。本文件只用到
`--space-2 = 8px` / `--space-3 = 12px` / `--space-4 = 16px`，写法一律 `var(--space-N, 回退值)`，
回退值与其定义逐一相等，因此单独加载也正确。未用 `--space-5/6`（20/28px，属卡片与页面级）。

## 顺手修掉的既有缺陷

排行榜榜单行的序号方块：`#tab-discover .media-row > .media-artwork`（1 id + 2 class）压过了
`#tab-discover .ranking-ordinal`（1 id + 1 class），于是序号被渲染成 `--row-art` 尺寸（44px），
横向溢出自己那条 30px 的网格轨道、压到标题起始位置。改成同权重选择器
`#tab-discover .media-row > .ranking-ordinal` 后声明的尺寸才真正生效。**不是本轮改动引入的。**

## 未完成 / 待决策

- 首屏「播放器条以上可见行数」桌面为 3.3 行。该数字被列表上方约 450px 的页头 / 搜索表单 /
  结果卡头部 / 批量条主导，其中卡片与表单留白属 density agent；本文件只贡献其中约 10px。
  滚动到列表后滚动窗口内可见 6.0 行（改前 6.3），是实际使用姿态下的持平。
- `.batch-actions` 保持 `overflow-x: auto` 横滑条不变，只加了滚动阴影提示（`background-attachment:
  local, scroll`），已在明暗两种主题、三个滚动位置（0 / 中段 / 末端）逐张核对。
