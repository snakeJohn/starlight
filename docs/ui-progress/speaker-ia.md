# 音箱页信息架构重排 · 进度

**目标**：五个模块（账号 / 设备+设备设置 / 播放控制+歌单列表 / 索引 / 语音记录）当前分属两行独立 2 列网格，矮卡片旁形成大片空洞。重排为可辩护的整体布局。

## 状态
- ✅ 基线测量（1440×900，真实数据 + 假播放）：
  - 第 1 行 `speaker-top-layout`：账号 368px / 设备 559px → 账号与下一行之间空洞 **204px**
  - 第 2 行 `speaker-operations-layout`：播放控制+歌单列表 1223px / 索引 297px → 索引下方空洞 **940px**
  - `#tab-speaker` 整页高度 **2080px**
- ✅ 结构改造（`static/index.html`，仅 `#tab-speaker`）：两行独立网格合并为**一个页面级网格**，删掉 `speaker-top-layout` / `speaker-operations-layout` 两个 wrapper，四个直接子项由 CSS 显式定位；账号 section 加 `speaker-account-panel` 类以便定位。未动任何 `data-role` / `data-action`。
- ✅ 新布局：
  - 左列 = 播放控制 + 歌单列表（现场操作面），跨 3 行；
  - 右栏 = 账号 → 设备/设备设置 → 索引（先配置、后状态，都是窄卡片）；
  - 语音记录 = 整幅页脚（它是日志，条目本身按 `auto-fit minmax(280px,1fr)` 铺开，且是唯一会无限增长的模块）。
- ✅ 样式全部写在 `scratchpad/polish2-speaker-ia.css`：只写栅格与定位；行距沿用 `.surface-section { margin-top }`、列距沿用 `.two-column { gap }`，即卡片内边距/卡间距/标题字号仍归 polish2-density.css 管。未加任何颜色。
- ✅ 窄屏 ≤1180px 退回单列，顺序与改动前完全一致：账号 → 设备 → 播放控制/歌单列表 → 索引 → 语音记录。断点取 1180 而非全站的 980，因为右栏要放设备表单，低于 1180 时右栏不足 450px 会开始乱折行。
- ✅ 截图复核：1440×900、整页、1280×900、390×844、390 整页、`html[data-theme="dark"]` 暗色整页，均正常。
- ✅ `npx vitest run tests/ui` → 33 files / 179 tests 全绿；`data-action="speaker-player-song-list"` 全文仍为 3 个。

## 关键测量
- 最大空洞高度：改前 **940px** → 改后 **102px**（左列播放控制底部到右栏索引底部的落差）
- 右栏三卡之间的间距：20px / 20px（来自 `--card-gap`，非本次设定）
- `#tab-speaker` 整页高度：改前 **2080px** → 改后 **1820px**

## 未完成 / 待决策
- 歌单列表没有高度上限，歌单数量多时左列会继续变高、右栏下方重新出现空洞（属列表密度 agent 的范围，本次没动）。
- `tests/ui/static_layout.test.ts:422` 用 `<div class="two-column speaker-operations-layout">` 作为「设备卡片区段」的结束标记；该 wrapper 已删除，`indexOf` 返回 -1，断言退化成「从设备卡片到本页结尾」。断言仍然成立且仍有意义（设备设置表单在设备列表之前），但那行标记已失效，建议后续换成结构无关的标记。
- `polish2-density.css` 里 `#tab-speaker .speaker-top-layout` 的两条规则随该类删除已成死代码，可清理（不属本 agent 文件，未改）。
