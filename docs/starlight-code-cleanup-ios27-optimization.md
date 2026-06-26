# Starlight 代码优化、冗余清理与 iOS 27 风格 UI 优化文档

日期: 2026-06-25

## 1. 文档目标

本文档用于指导 `J:\plugins` 当前 Starlight 插件项目的下一轮优化工作，覆盖四类目标:

1. 优化项目代码结构，降低前端大文件和重复工具函数带来的维护成本。
2. 清理冗余文件和本地参考目录，避免构建产物、迁移参考源码和真实插件工程混在一起。
3. 修复或预防可能存在的 Bug，所有行为变更必须先补回归测试。
4. 参考 iOS 27 / Apple Liquid Glass 方向优化插件前端展示效果，但保持后台工具型插件的效率和密度。

本文档不直接要求一次性重写插件。推荐分阶段执行，每一阶段都能独立测试、独立提交、独立回滚。

## 2. 当前项目基线

### 2.1 项目性质

当前仓库根目录就是 Starlight 插件工程根目录，核心结构如下:

- `src/`: TypeScript 后端逻辑，包括音乐源、Songloft 桥接、MIoT 音箱、下载、语音口令、定时任务、路由和系统工具。
- `static/`: 插件 Web UI，使用原生 HTML、CSS 和浏览器 ES modules。
- `tests/`: Vitest 测试，覆盖 UI 静态结构、渲染工具、后端 handler、音乐平台、桥接、下载、语音、发布元数据等。
- `docs/`: 已有设计文档、实现计划和 API 文档。
- `dist/`: 构建产物，已被 `.gitignore` 忽略。

### 2.2 当前验证结果

本次梳理时已执行:

```powershell
npm run typecheck
npm test
```

结果:

- `npm run typecheck`: 通过。
- `npm test`: 57 个测试文件通过，346 个测试通过。

这说明当前 TypeScript 编译和现有自动化测试没有暴露失败。后续“Bug 修复”应以新增测试复现问题为前提，而不是无根据地改动稳定路径。

### 2.3 当前主要维护风险

前端维护压力集中在几个大文件:

- `static/js/music.js`: 约 79KB，职责包含分页、搜索、音源、下载、歌单、自建歌单、Songloft 曲库、排行榜和多个渲染工具。
- `static/js/speaker.js`: 约 32KB，职责包含账号、二维码登录、设备选择、播放器控制和语音记录。
- `static/js/automation.js`: 约 21KB，职责包含语音口令、定时任务、索引和配置表单。
- `static/css/style.css`: 集中了全局主题变量、布局、行组件、表单、响应式和状态样式。

这些文件当前可以工作，但后续继续加功能时容易出现全局选择器误伤、重复逻辑、状态污染和视觉回归。

### 2.4 Songloft 宿主约束

该插件不是普通独立 Web 应用，而是运行在 Songloft JS 插件系统中的插件。所有代码优化和 UI 改造必须服从以下边界:

- 运行时模型: 每个插件是独立 Actor，运行在自己的 QuickJS VM 中；后端请求入口是 `onHTTPRequest(req)`，插件初始化和卸载由 `onInit()`、`onDeinit()` 管理。
- 权限模型: `plugin.json` 中声明的 `storage`、`songs.read`、`songs.write`、`playlists.read`、`playlists.write`、`inter-plugin`、`command`、`jsenv` 必须和实际能力一致，新增能力前先确认权限。
- 静态资源: 插件 UI 通过 `static/` 提供，安装后路径为 `/api/v1/jsplugin/{entryPath}/` 和 `/api/v1/jsplugin/{entryPath}/static/<file>`。
- 公共注入: Songloft 会自动注入 `<base>`、认证桥接、`common.css` 和 `common.js`，插件前端应使用相对路径访问 `static/...` 和插件 API，不要重复打包字体、宿主 CSS 变量或公共 API 工具。
- 浏览器端 API: 前端可使用 `window.SongloftPlugin` 获取 token、调用插件 API、监听主题变化；现有 `static/js/auth.js` 和 `static/js/api.js` 应继续围绕该能力封装。
- 安全校验: 构建产物会写入 `entryHash` 和 `zipHash`，不要手工改 hash；发布前必须使用工具链构建和校验。
- 热更新: Songloft 支持同 `entryPath` 覆盖更新并自动热重载，插件必须保证 `onDeinit()` 能清理监听、定时器、运行锁和后台任务。
- 性能边界: `onHTTPRequest` 应快速返回，长耗时网络任务和批处理应使用缓存、队列或后台任务，避免阻塞插件 VM。

本插件当前 `entryPath` 是 `starlight`，安装后页面入口应保持:

```text
/api/v1/jsplugin/starlight/
```

API 调用继续使用相对路径:

```text
api/...
```

这样可以兼容 Songloft 的 `BASE_PATH` 子路径部署和反向代理场景。

### 2.5 Songloft 产品与合规边界

Songloft 是面向个人用户的自托管音乐服务器，Starlight 涉及 LX 音源导入、歌词、封面、下载和音箱播放桥接，因此必须继续保持以下边界:

- 不内置、不分发、不默认启用第三方音源。
- 用户导入的 LX 音源只保存在插件私有存储中，UI 只做管理和调用。
- 下载、歌词、封面等能力要明确由用户自行承担版权合规责任。
- 日志和错误提示不得输出账号密码、Token、Cookie、AI Key 或音源私密配置。
- 发布包中不得包含付费音源、私人音源或本地测试账号信息。

## 3. 冗余文件与目录清理策略

### 3.1 可直接视为生成物或本地状态的目录

以下内容不应作为业务源码维护:

- `dist/`: 构建输出，可通过 `npm run build` 再生成。
- `node_modules/`: 依赖安装目录，可通过 `npm ci` 再生成。
- `.songloft-dev.json`: 本地开发配置，已被 `.gitignore` 忽略。
- `.worktrees/`: 本地工作树目录，已被 `.gitignore` 忽略。
- `.superpowers/`: 本地流程状态，已被 `.gitignore` 忽略。

建议:

- 日常提交前只检查 tracked 文件，不把上述目录纳入代码审查。
- 如果需要释放磁盘空间，可以删除 `dist/`、`node_modules/`、`.worktrees/` 中不再使用的内容；删除前确认没有正在运行的 dev server 或未迁移的工作树。

### 3.2 本地参考源码目录

以下目录被 `.git/info/exclude` 忽略，不属于当前 Git 跟踪内容:

- `lxmusic.jsplugin/`
- `lxserver/`
- `songloft-plugin-miot/`

它们更像 Starlight 早期迁移时的参考源码快照。不要在没有确认的情况下直接删除，因为已有历史设计文档把它们作为迁移参考。

推荐处理方式:

1. 如果后续开发仍需对照 LX Music 或 MIoT 原实现，保留这些目录，但在 README 或本文件中说明它们是“本地参考，不参与发布”。
2. 如果迁移已完成且不再需要对照，将这些目录移动到 `J:\plugin-references\` 这类仓库外目录。
3. 如果确认完全不需要，再删除目录，并记录删除原因。

### 3.3 不建议清理的内容

以下内容不要作为“冗余”删除:

- `docs/superpowers/specs/` 和 `docs/superpowers/plans/`: 保存了重要设计决策和实现计划。
- `tests/`: 当前测试覆盖是项目稳定性的主要保障。
- `src/data/holidays/2026.json`、`src/data/holidays/2027.json`: 构建前脚本会使用节假日数据。
- `registry.json`、`plugin.json`、`package-lock.json`: 发布和安装依赖链路需要。

## 4. 代码结构优化方案

### 4.1 前端模块拆分

当前 `static/js/music.js` 职责过多。建议拆成以下模块:

```text
static/js/music/
  pagination.js          # 分页计算、分页渲染、分页事件绑定
  renderers.js           # 歌曲行、封面、歌单行、榜单行、空状态渲染
  sources.js             # 播放/下载音源导入、合并、启停、删除、分页
  search.js              # 歌曲搜索、批量选择、批量导入、批量下载、推送音箱
  downloads.js           # 下载设置、下载进度、下载轮询
  custom_playlists.js    # 自建歌单列表、详情、导入、刷新、删除、加歌
  songloft_library.js    # Songloft 曲库、歌单、本地歌曲读取与推送
  songlists.js           # 外部歌单搜索、推荐、详情分页
  rankings.js            # 排行榜加载、详情分页
```

`static/js/music.js` 保留为聚合入口:

```js
import { initSearchUI } from './music/search.js';
import { initSourceUI } from './music/sources.js';
import { initSonglistUI } from './music/songlists.js';
import { initRankingUI } from './music/rankings.js';

export async function initMusicUI() {
  await Promise.all([
    initSearchUI(),
    initSourceUI(),
    initSonglistUI(),
    initRankingUI(),
  ]);
}
```

收益:

- 单个文件更短，便于 review 和定位问题。
- 渲染工具可以独立测试。
- 搜索、音源、歌单、排行榜互不影响。

### 4.2 Speaker 模块拆分

建议把 `static/js/speaker.js` 拆为:

```text
static/js/speaker/
  account.js        # 账号列表、重新登录、删除账号
  qrcode.js         # 二维码生成、轮询、过期状态
  devices.js        # 设备列表、设备选择、保存/取消选择
  player.js         # 音箱播放状态和控制按钮
  voice_records.js  # 12 小时语音记录、轮询、清空
```

重点保留的测试:

- 二维码登录成功后隐藏二维码。
- 切换账号会清空设备选择。
- 保存设备和取消设备选择按钮可见、可用。
- 音箱播放器按钮只出现在音箱页。

### 4.3 Automation 模块拆分

建议把 `static/js/automation.js` 拆为:

```text
static/js/automation/
  config.js          # 设备设置和定时设置表单
  voice_commands.js  # 语音口令编辑器
  schedules.js       # 定时任务表单、填入、启停
  indexing.js        # 索引状态和刷新
```

重点约束:

- `data-role="config-state"` 这类重复字段必须在表单内查找，禁止未来新增代码使用不带作用域的全局选择器直接写入。
- `conversation_monitor_enabled` 关闭时，`voice_command_enabled` 必须禁用并取消勾选。
- 定时任务配置只影响自动化页，音箱设置只影响音箱页。

### 4.4 公共工具抽取

多个前端文件存在类似工具函数，建议抽取:

```text
static/js/shared/
  arrays.js      # asArray、resultCount
  dom.js         # scoped query、event delegation、safe button busy state
  forms.js       # textValue、boolValue、numberValue、setField
  format.js      # durationLabel、relativeTime、safe display text
  render.js      # actionButton、emptyState、statusChip
```

抽取原则:

- 只抽真正重复且稳定的工具。
- 不把业务流程抽成“万能框架”。
- 每个工具模块要有小型单元测试或被现有 UI 测试覆盖。

## 5. Bug 修复与预防清单

当前自动化测试通过，暂未发现必须立即修复的编译级或测试级 Bug。建议下一阶段重点排查以下潜在缺陷:

### 5.1 全局选择器误伤

风险:

- 页面里有多个配置表单和重复 `data-role`。
- 如果后续代码使用 `$('[data-role="config-state"]')` 直接写入，可能更新到错误面板。

处理:

- 新增测试，确保保存音箱设置只更新音箱设置状态，保存定时设置只更新自动化设置状态。
- 约束写法为 `form.querySelector('[data-role="config-state"]')`。

### 5.2 初始化和轮询重复绑定

风险:

- `initMusicUI()`、`initSpeakerUI()`、`initAutomationUI()` 当前按页面启动只执行一次。
- 若后续支持热更新、局部重载或重复执行 boot，事件监听和定时器可能重复绑定。

处理:

- 为各模块增加 `initialized` guard 或 `destroy()`。
- 语音记录轮询、下载进度轮询和二维码轮询都要有明确 stop 逻辑。
- 测试重复调用 init 不会触发重复 API 请求。

### 5.3 音源合并键冲突

风险:

- 当前音源合并主要依赖名称、文件名或 ID。
- 如果播放音源和下载音源同名但不是同一份源，可能在 UI 上被错误合并为同一行。

处理:

- 优先使用后端返回的稳定 bundle id、hash 或导入批次 ID。
- UI 上允许显示“同名但不同来源”的两行，避免误删或误启停。
- 增加测试覆盖同名不同 ID 音源的合并行为。

### 5.4 部分初始化失败不可见

风险:

- `boot()` 使用 `Promise.allSettled` 初始化多个 UI 域，只把第一个失败写入全局 message。
- 用户可能不知道是音乐、音箱、自动化还是日志模块失败。

处理:

- 在顶部状态区显示分域状态: 音乐、音箱、自动化、诊断。
- 失败模块提供“重试”按钮或跳转到日志页。
- 测试模块初始化失败时显示明确模块名。

### 5.5 构建产物与发布元数据不一致

风险:

- `plugin.json`、`package.json`、`registry.json` 和 `dist/` 构建产物需要版本一致。

处理:

- 发布前固定执行:

```powershell
npm run version:stamp
npm run build
npm run validate
npm test
npm run typecheck
```

- Songloft 实例联调固定执行:

```powershell
npm run dev -- --host http://<songloft-host>:58091 --username <user> --password <password> --once
```

- 保留现有 release 测试，不手改 hash 和 releaseVersion。

## 6. iOS 27 / Liquid Glass 风格 UI 设计方向

### 6.1 设计基准说明

公开、稳定的 Apple 官方参考主要是 Liquid Glass 和 Human Interface Guidelines。本文档把“iOS 27 风格”落地为以下方向:

- 半透明但可读的 glass surface。
- 内容层级清晰，控件从内容中分离。
- 圆角克制，插件后台工具界面保持 8px 左右的紧凑圆角。
- 避免装饰性渐变光球、纯氛围背景和营销式 hero。
- 深浅色跟随 Songloft 主题变量。
- 移动端尊重 safe area，底部 tab 不遮挡内容。

参考:

- Apple Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines

### 6.2 当前 UI 的保留点

当前 UI 已有一些正确方向，应保留:

- 左侧 rail + 移动端底部 tab。
- 顶部状态条显示账号、设备、音源状态。
- `color-mix()`、`backdrop-filter`、主题变量和深色模式基础。
- 卡片半径控制在 `--radius: 8px`。
- 音乐列表使用固定封面尺寸和可滚动容器。
- 批量操作按钮在移动端可横向滚动，避免挤压。

### 6.3 视觉优化项

建议按以下顺序优化:

1. 增强 glass surface 层级
   - `side-rail`、`status-strip`、移动底部 tab 使用更稳定的透明度和边框高光。
   - 普通内容区减少玻璃感，保持高可读性。

2. 建立统一设计 token
   - 增加 `--surface-elevated`、`--surface-control`、`--hairline`、`--focus-ring`。
   - 将按钮、输入框、列表行都从 token 读取颜色和边框。

3. 优化按钮语义
   - 高频命令保留文字按钮。
   - 播放控制、刷新、删除、选择等可逐步改为图标加 tooltip。
   - 如果项目不引入图标库，可优先用 Songloft 或系统可用图标；不要手写大量自定义 SVG。

4. 优化信息密度
   - 搜索、歌单、排行榜保持工具型密度，不做大卡片瀑布流。
   - 长文本使用两行 clamp，操作按钮可换行但不撑破容器。

5. 优化状态反馈
   - 空状态说明下一步可执行动作。
   - 错误状态显示来源、原因和重试动作。
   - 顶部状态条不只显示“初始化存在错误”，而应显示具体模块。

### 6.4 与 Songloft 主题系统对齐

视觉升级不要绕开宿主主题系统。建议:

- 保留 `static/css/style.css` 作为插件自定义样式，但颜色优先映射 Songloft 注入的主题变量，再 fallback 到当前 `--sl-*` 或本地默认值。
- 不在插件内打包字体文件，不重复引入宿主已经注入的 common CSS。
- 监听 `songloft-theme-change` 或使用 `SongloftPlugin.onThemeChange` 做必要的非 CSS 状态同步。
- 所有资源路径保持相对路径，例如 `static/icon.svg`、`static/js/app.js` 和 `api/music/platforms`，避免在反向代理子路径下失效。

### 6.5 响应式验收

至少检查以下视口:

- 390 x 844: 移动端底部 tab、安全区、长按钮和列表行。
- 768 x 1024: 平板窄屏，双栏应降为单栏或保持不溢出。
- 1440 x 900: 桌面端左侧 rail、顶部状态和主要内容密度。

验收标准:

- 页面无水平滚动，除明确允许横向滚动的批量按钮条。
- 底部 tab 不遮挡最后一屏内容。
- 长歌名、长歌单名、长设备名、长错误信息不溢出父容器。
- 明暗主题下文字对比度足够。

## 7. 分阶段执行计划

### 阶段 1: 清理边界确认

目标:

- 明确哪些目录属于源码，哪些是本地参考或生成物。

动作:

1. 保留 `src/`、`static/`、`tests/`、`docs/`、`scripts/` 和根清单文件。
2. 删除或忽略 `dist/`、`node_modules/`、`.worktrees/` 等本地生成目录。
3. 对 `lxmusic.jsplugin/`、`lxserver/`、`songloft-plugin-miot/` 做决策: 保留为参考、移动到仓库外、或删除。

验证:

```powershell
git status --ignored --short
npm ci
npm run typecheck
npm test
```

### 阶段 2: 前端公共工具抽取

目标:

- 在不改变 UI 行为的前提下减少重复工具函数。

动作:

1. 新建 `static/js/shared/`。
2. 抽取数组、DOM、表单、格式化工具。
3. 让 `music.js`、`speaker.js`、`automation.js` 逐步引用 shared 工具。

验证:

```powershell
npm test -- tests/ui/static_layout.test.ts tests/ui/music_rendering.test.ts tests/ui/speaker_controls.test.ts tests/ui/settings_config.test.ts
npm run typecheck
```

### 阶段 3: `music.js` 拆分

目标:

- 将最大前端文件拆成按业务域组织的小模块。

动作:

1. 先抽 `renderers.js` 和 `pagination.js`，测试成本最低。
2. 再抽 `sources.js` 和 `downloads.js`。
3. 最后抽搜索、歌单、排行榜和 Songloft 曲库模块。

验证:

```powershell
npm test -- tests/ui/music_rendering.test.ts tests/ui/music_pagination.test.ts tests/ui/custom_playlists.test.ts tests/ui/songloft_library.test.ts tests/ui/source_zip.test.ts
npm test -- tests/ui/static_layout.test.ts
```

### 阶段 4: Speaker 与 Automation 拆分

目标:

- 降低账号、设备、播放器、语音记录、配置、定时任务互相影响的风险。

动作:

1. 拆 `speaker/qrcode.js`、`speaker/devices.js`、`speaker/player.js`。
2. 拆 `automation/config.js`、`automation/voice_commands.js`、`automation/schedules.js`。
3. 增加重复初始化和表单作用域测试。

验证:

```powershell
npm test -- tests/ui/speaker_qrcode.test.ts tests/ui/speaker_controls.test.ts tests/ui/settings_config.test.ts tests/ui/voice_command_editor.test.ts
npm run typecheck
```

### 阶段 5: iOS 27 风格视觉升级

目标:

- 在不牺牲工具效率的情况下增强现代 Apple 风格质感。

动作:

1. 重整 CSS token。
2. 调整 glass surface、状态条、底部 tab、列表行和表单控件。
3. 优化移动端间距、安全区、按钮换行和空状态。
4. 必要时补充图标按钮和 tooltip。

验证:

```powershell
npm test -- tests/ui/static_layout.test.ts
npm test -- tests/ui/music_rendering.test.ts tests/ui/speaker_controls.test.ts
```

手工验收:

- 打开插件 UI。
- 检查搜索、音箱、歌单、排行、音源、日志、自动化七个 tab。
- 检查桌面、平板、手机视口下无文字重叠和控件溢出。

### 阶段 6: 发布前完整验证

目标:

- 确认代码、测试、构建和插件清单一致。

命令:

```powershell
npm run typecheck
npm test
npm run build
npm run validate
git status --short
```

通过标准:

- TypeScript 无错误。
- Vitest 全部通过。
- 构建成功。
- 插件清单校验成功。
- Git 只包含预期改动。

## 8. 风险与回滚

### 8.1 风险

- 前端拆分可能改变模块初始化顺序。
- CSS token 调整可能影响 Songloft 注入主题下的明暗色。
- 清理目录时可能误删仍需参考的外部源码。
- 音源合并逻辑修复可能改变用户已熟悉的音源列表显示。

### 8.2 回滚策略

- 每个阶段单独提交。
- 先做测试覆盖，再做行为调整。
- 视觉改造单独提交，避免和业务修复混在一起。
- 清理本地参考目录前先移动到仓库外，不立即永久删除。

## 9. 最终验收清单

- `npm run typecheck` 通过。
- `npm test` 全部通过。
- `npm run build` 通过。
- `npm run validate` 通过。
- `static/js/music.js` 拆分后入口职责清晰。
- 音箱和自动化配置不会互相写错状态。
- 音源同名冲突有明确处理。
- 七个前端 tab 在桌面和移动端无重叠、无异常水平滚动。
- `dist/`、`node_modules/` 和本地参考目录不混入提交。
- README 或 docs 说明本地参考目录的处理方式。

## 10. 参考资料

- Songloft GitHub 仓库: https://github.com/songloft-org/songloft
- Songloft JS 插件开发文档: https://songloft.hanxi.cc/js-plugin-development-guide.html
- Songloft 插件工具链: https://github.com/songloft-org/plugin-toolchain
- Apple Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
