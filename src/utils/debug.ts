// MIoT 智能音箱插件 - 轮询调试日志开关
//
// 会话监听默认每秒轮询，稳态（无新消息）下若打印大量 info 日志会构造模板字符串
// 并跨 __go_console 桥，纯浪费且刷屏。用一个同步可读的布尔缓存门控这些日志：
// 轮询在热路径上，不能每 tick 去 await 读配置，因此由配置加载/更新时通过
// setPollDebug 写入本模块的缓存，热路径用 isPollDebug() 同步读取。
//
// 对应设置项 PluginConfig.conversation_poll_debug（默认 false）。

let _pollDebug = false;

/** 热路径同步读取当前轮询调试日志开关。 */
export function isPollDebug(): boolean {
  return _pollDebug;
}

/** 由配置加载/更新时调用，更新缓存的开关值。 */
export function setPollDebug(enabled: boolean): void {
  _pollDebug = !!enabled;
}
