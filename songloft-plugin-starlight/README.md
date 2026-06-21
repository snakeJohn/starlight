# songloft-plugin-starlight

Starlight combines MIoT smart speaker control with user-imported LX Music sources.
No music source is bundled or enabled by default.
The Star Sea source is used only as a manual acceptance-test import.
Paid source files are excluded from implementation, tests, bundles, and logs.

> ™️ **商标声明**：本插件中提到的 "MIoT" "MiHome" 等协议 / 产品名称均归各自商标权人所有，相关名称的出现仅出于互操作和指示性合理使用目的。本插件**未获得任何商标持有人的授权或背书**，与上述商标持有人**无任何关联**。

## Development

```bash
npm install
npm run dev         # watch + auto-upload Starlight to local Songloft
npm run typecheck   # TypeScript check
npm run build       # produce dist/starlight.jsplugin.zip
npm run validate    # verify Starlight plugin metadata and hashes
```

## Description

智能音箱设备控制示例插件。本仓库仅提供与宿主 SDK 对接的脚手架代码，**不附带任何第三方设备协议实现或账号体系**，使用者需自行负责接入合规性。

## 定时任务 - 法定节假日

定时任务的「每周」调度支持中国法定节假日感知,有三种模式:

- **忽略节假日**(默认):完全按勾选的星期触发,行为与节假日无关。
- **仅法定节假日触发**:今天必须是法定放假日(春节、国庆等)才触发,且星期也需在勾选范围内。适合「节假日早晨播音乐迎接好心情」这类场景。
- **真·工作日(跳过节假日,含调休补班)**:勾选「周一到周五」后开启此模式,则节假日跳过、调休补班的周末强制触发,符合「真正上班日的闹钟」语义。

节假日数据来自 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)(MIT 协议),由 `npm run build`(或 `dev`)的 `prebuild` 钩子从 jsDelivr / GitHub raw 下载,覆盖当前年和下一年,并通过 esbuild 编入插件 bundle。运行时不需要网络访问。

注意事项:
- 国务院通常每年 11 月公布次年安排,在此之前下一年的节假日数据为空,此时会按「平常日」处理(不影响普通调度,但「仅法定节假日触发」模式将不会触发)。
- 每次发版会自动滚动到最新数据;长期未更新的插件版本可能缺失最新节假日,建议定期升级插件。
- 数据下载产物已 commit 入库,本地无网络也可构建。

## Author

hanxi

## 免责声明

- 本项目**仅供个人学习研究技术使用**，严禁任何形式的商业用途，不得使用本代码进行任何形式的牟利 / 贩卖 / 传播。
- 本项目不附带任何第三方设备协议实现或账号体系；与第三方设备通信所产生的数据、账号凭据均由使用者自行提供与管理，对于这些数据本项目不拥有所有权。
- 本项目完全免费，仅供个人私下范围研究交流学习技术使用，对于使用者在违反当地法律法规情况下使用本项目所造成的任何违法违规行为，由使用者自行承担。
- 若你使用了本项目，即代表你接受以上声明。

## License

Apache-2.0 © 2026 hanxi
