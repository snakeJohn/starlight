// MIoT 智能音箱插件 - 对话监听器
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/conversation/monitor.go
// 定时轮询设备对话记录，支持回调通知和 Webhook 推送

/// <reference types="@songloft/plugin-sdk" />

import { AccountManager } from '../account/manager';
import { ConfigManager } from '../config/manager';
import type { ConversationMessage, AskMessage, WebhookConfig } from '../types';
import { MinaHTTPClient } from '../mina/client';
import { validateOutboundWebhookUrl } from '../utils/url_safety';

// ===== 类型定义 =====

/** 内部回调函数类型 */
export type ConversationCallback = (msg: ConversationMessage) => void | Promise<void>;

/** 设备监听状态 */
interface DeviceMonitorState {
  accountId: string;
  deviceId: string;
  deviceName: string;
  hardware: string;
  lastTimestampMs: number;
  primed: boolean;
  isRunning: boolean;
  /** Last poll diagnostic (empty when healthy). Surfaced to UI for "基线未建立". */
  lastError: string;
  lastPollAtMs: number;
}

/** 监听器状态（与 WASM 版 MonitorStatus 一致） */
export interface MonitorStatus {
  is_enabled: boolean;
  device_count: number;
  devices: DeviceMonitorStatusItem[];
  webhook_count: number;
  message_count: number;
}

/** 设备监听状态项（与 WASM 版 DeviceMonitorStatusItem 一致） */
export interface DeviceMonitorStatusItem {
  account_id: string;
  device_id: string;
  device_name: string;
  is_running: boolean;
  last_timestamp_ms: number;
  primed: boolean;
  last_error: string;
  last_poll_at_ms: number;
}

// ===== ConversationMonitor =====

/**
 * ConversationMonitor - 对话记录监听器
 * 定时轮询所有 managed 设备的对话记录，检测新消息并触发回调/Webhook
 */
export class ConversationMonitor {
  private accountManager: AccountManager;
  private configManager: ConfigManager;

  /** 环形消息缓冲区 */
  private messages: ConversationMessage[] = [];
  private maxMessages: number = 200;

  /** 轮询定时器 */
  private pollTimer: any = null;
  private pollInterval: number = 1000; // 默认1秒，从配置读取

  /** 设备监听状态: "accountId:deviceId" → DeviceMonitorState */
  private devices: Map<string, DeviceMonitorState> = new Map();

  /** 内部回调（观察者模式） */
  private callbacks: Map<string, ConversationCallback> = new Map();

  /** 是否启用 */
  private enabled: boolean = false;

  /** Prevent overlapping poll cycles within the same monitor run. */
  private pollInFlightGenerations: Set<number> = new Set();
  private pollRequestSequence = 0;

  /** Increments at every start/stop so stale async work cannot affect a new run. */
  private runGeneration = 0;

  /** Invalidate older refreshDevices() calls that are still awaiting account data. */
  private refreshSequence = 0;

  /** Bound webhook delivery so a hung recipient cannot stall the monitor. */
  private static readonly WEBHOOK_TIMEOUT_MS = 5000;

  /** A single device request must not block initial priming or later devices. */
  private static readonly DEVICE_POLL_TIMEOUT_MS = 10_000;

  /** Throttle repeated "fetch failed / no client" warnings (ms per device). */
  private static readonly DIAG_WARN_INTERVAL_MS = 30_000;
  private lastDiagWarnAt: Map<string, number> = new Map();

  constructor(accountManager: AccountManager, configManager: ConfigManager) {
    this.accountManager = accountManager;
    this.configManager = configManager;
  }

  private shouldDiagWarn(key: string): boolean {
    const now = Date.now();
    const last = this.lastDiagWarnAt.get(key) ?? 0;
    if (now - last < ConversationMonitor.DIAG_WARN_INTERVAL_MS) {
      return false;
    }
    this.lastDiagWarnAt.set(key, now);
    return true;
  }

  // ===== 公开方法 =====

  /**
   * 启动对话监听
   * 遍历所有 managed 设备，启动定时轮询
   * 回调通过 registerCallback() 独立注册，start() 只管启停
   *
   * 返回 Promise：await 后设备列表已初始化完成、首轮基线已建立、定时器已就绪，
   * 调用方随后查询 getStatus() 即可拿到真实设备数量。
   */
  async start(): Promise<void> {
    // 已启动且定时器正在运行，直接返回
    if (this.enabled && this.pollTimer !== null) {
      songloft.log.info('[ConversationMonitor] Already running, skip start');
      return;
    }

    // 清理残留的定时器
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.enabled = true;
    const runGeneration = ++this.runGeneration;

    try {
      // 从配置读取轮询间隔
      const config = await this.configManager.getConfig();
      // getConfig 可能耗时，其间若被 stop()，则放弃启动
      if (!this.isRunCurrent(runGeneration)) return;

      const intervalSec = Math.max(1, Math.min(30, config.conversation_poll_interval ?? 1));
      this.pollInterval = intervalSec * 1000;

      // 等待设备列表刷新完成，确保 getStatus() 能读到真实设备数
      const refreshSequence = ++this.refreshSequence;
      await this.refreshDevices(runGeneration, refreshSequence);
      // A manual refresh may supersede this snapshot while start() is waiting.
      // Keep starting from the latest shared map; only a stopped/restarted run
      // invalidates this continuation entirely.
      if (!this.isRunCurrent(runGeneration)) return;

      // Every start establishes a fresh server-timestamp baseline.
      // 注意：不能用 Date.now() 预置 lastTimestampMs（本地时钟与小米服务端
      // 时间戳不同轴）。基线交给首轮 poll 用服务端返回值建立。
      for (const dm of this.devices.values()) {
        dm.isRunning = true;
        dm.lastTimestampMs = 0;
        dm.primed = false;
      }
      songloft.log.info(`[ConversationMonitor] Started, devices=${this.devices.size} callbacks=${this.callbacks.size} interval=${intervalSec}s`);

      // 先同步跑一轮把基线建起来，再装定时器。
      // 独立 try/catch：建基线失败绝不能阻止下面的定时器安装，否则监听彻底不工作
      try {
        await this.pollAll(runGeneration);
      } catch (e) {
        songloft.log.warn('[ConversationMonitor] Initial priming failed: ' + String(e));
      }
      // 建基线期间可能被 stop()
      if (!this.isRunCurrent(runGeneration)) return;

      if (this.pollTimer !== null) {
        clearInterval(this.pollTimer);
      }
      this.pollTimer = setInterval(() => {
        this.pollAll(runGeneration).catch(e => {
          songloft.log.error('[ConversationMonitor] pollAll error: ' + String(e));
        });
      }, this.pollInterval);
    } catch (e) {
      songloft.log.error('[ConversationMonitor] start error: ' + String(e));
      // A failed initialization must not leave the listener looking enabled
      // while no timer is installed. Preserve stale-start cancellation: if a
      // newer run or stop() already superseded this generation, its state wins.
      if (this.isRunCurrent(runGeneration)) {
        this.enabled = false;
        this.runGeneration += 1;
        this.refreshSequence += 1;
        if (this.pollTimer !== null) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.devices.clear();
        throw e;
      }
    }
  }

  /**
   * 停止对话监听
   */
  stop(): void {
    if (!this.enabled && this.pollTimer === null) {
      return;
    }

    this.enabled = false;
    this.runGeneration += 1;
    this.refreshSequence += 1;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // 清空设备列表：下次 start() 会重新刷新，避免残留旧状态导致
    // 「首次开启显示 0 台、需重新开关才恢复」的表象误判
    this.devices.clear();

    songloft.log.info(`[ConversationMonitor] Stopped`);
  }

  /**
   * 刷新设备列表：停止已移除设备的监听，启动新增设备的监听
   */
  async refresh(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const runGeneration = this.runGeneration;
    const refreshSequence = ++this.refreshSequence;
    await this.refreshDevices(runGeneration, refreshSequence);
  }

  /**
   * 注册内部回调（观察者模式）
   */
  registerCallback(name: string, cb: ConversationCallback): void {
    this.callbacks.set(name, cb);
    songloft.log.info(`[ConversationMonitor] Callback registered: ${name}`);
  }

  /**
   * 取消内部回调
   */
  unregisterCallback(name: string): void {
    this.callbacks.delete(name);
    songloft.log.info(`[ConversationMonitor] Callback unregistered: ${name}`);
  }

  /**
   * 获取消息记录（最近N条）
   * @param limit - 返回条数限制（默认50）
   * @param sinceTimestampMs - 只返回此时间戳之后的消息（默认0=全部）
   */
  getMessages(limit: number = 50, sinceTimestampMs: number = 0): ConversationMessage[] {
    let result = this.messages;

    // 按时间戳过滤
    if (sinceTimestampMs > 0) {
      result = result.filter(msg => msg.message.timestamp_ms > sinceTimestampMs);
    }

    // 限制返回条数（取最新的）
    if (limit > 0 && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    songloft.log.info(`[ConversationMonitor] getMessages total_stored=${this.messages.length} returning=${result.length} (limit=${limit} sinceTs=${sinceTimestampMs})`);
    return result;
  }

  clearMessages(): number {
    const count = this.messages.length;
    this.messages = [];
    songloft.log.info(`[ConversationMonitor] clearMessages cleared=${count}`);
    return count;
  }

  /**
   * 获取监听器状态（与 WASM 版一致）
   */
  async getStatus(): Promise<MonitorStatus> {
    const webhooks = await this.configManager.getWebhooks();
    const devices: DeviceMonitorStatusItem[] = [];
    for (const dm of this.devices.values()) {
      devices.push({
        account_id: dm.accountId,
        device_id: dm.deviceId,
        device_name: dm.deviceName,
        is_running: dm.isRunning,
        last_timestamp_ms: dm.lastTimestampMs,
        primed: dm.primed,
        last_error: dm.lastError || '',
        last_poll_at_ms: dm.lastPollAtMs || 0,
      });
    }
    return {
      is_enabled: this.enabled,
      device_count: this.devices.size,
      devices,
      webhook_count: webhooks.length,
      message_count: this.messages.length,
    };
  }

  /**
   * 是否已启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ===== 私有方法 =====

  /**
   * 刷新设备监听列表
   * 合并所有账号的 managed 设备
   */
  private async refreshDevices(runGeneration: number, refreshSequence: number): Promise<void> {
    const accounts = await this.accountManager.getAccounts();

    // Build the whole snapshot before touching the shared device map.
    const managedDevices: Array<{ accountId: string; deviceId: string; deviceName: string; hardware: string }> = [];

    for (const acc of accounts) {
      const managed = await this.accountManager.getManagedDevices(acc.id);
      for (const dev of managed) {
        managedDevices.push({
          accountId: acc.id,
          deviceId: dev.device_id,
          deviceName: dev.device_name,
          hardware: dev.hardware,
        });
      }
    }

    // An obsolete refresh must not delete or add devices for a newer run.
    if (!this.isRefreshCurrent(runGeneration, refreshSequence)) return;

    const managedKeys = new Set(managedDevices.map((dev) => this.makeKey(dev.accountId, dev.deviceId)));
    // 移除不再 managed 的设备
    for (const key of this.devices.keys()) {
      if (!managedKeys.has(key)) {
        const detached = this.devices.get(key);
        if (detached) {
          detached.isRunning = false;
        }
        this.devices.delete(key);
        songloft.log.info(`[ConversationMonitor] Device removed from monitoring: ${key}`);
      }
    }

    // 添加新的 managed 设备
    for (const dev of managedDevices) {
      const key = this.makeKey(dev.accountId, dev.deviceId);
      if (this.devices.has(key)) continue;
      this.devices.set(key, {
        accountId: dev.accountId,
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        hardware: dev.hardware || '',
        lastTimestampMs: 0,
        primed: false,
        isRunning: true,
        lastError: '',
        lastPollAtMs: 0,
      });
      songloft.log.info(
        `[ConversationMonitor] Device added to monitoring: ${dev.deviceName} (${key}) hardware=${dev.hardware || '(empty)'}`,
      );
    }
  }

  /**
   * 轮询所有设备的对话记录
   * Devices are polled concurrently; each device still has at most one request
   * per monitor run, so its message order is preserved while one slow speaker
   * cannot delay every other device's baseline.
   * Concurrent timer ticks are coalesced within the current monitor run.
   */
  private async pollAll(runGeneration: number): Promise<void> {
    if (!this.isRunCurrent(runGeneration)) {
      return;
    }
    if (this.pollInFlightGenerations.has(runGeneration)) {
      return;
    }
    this.pollInFlightGenerations.add(runGeneration);
    try {
      const devices = Array.from(this.devices.values()).filter(dm => dm.isRunning);
      await Promise.all(devices.map(dm => this.pollDevice(dm, runGeneration)));
    } finally {
      this.pollInFlightGenerations.delete(runGeneration);
    }
  }

  /**
   * 轮询单个设备
   * 获取对话记录 → 时间戳去重 → 触发回调 → 推送 Webhook
   *
   * 每个设备请求都有边界。Songloft v2.11 的 fetch 不会替调用方自动兜底，
   * 请求挂起时必须释放本地轮询状态，否则首轮 priming 永远阻塞定时器安装。
   */
  private async pollDevice(dm: DeviceMonitorState, runGeneration: number): Promise<void> {
    if (!this.isRunCurrent(runGeneration) || !dm.isRunning) {
      return;
    }

    // 获取 MinaHTTPClient
    const client = this.accountManager.getMinaClient(dm.accountId) as MinaHTTPClient | null;
    if (!client) {
      dm.lastError = '无 Mina 登录客户端（请重新登录小米账号）';
      dm.lastPollAtMs = Date.now();
      if (this.shouldDiagWarn(`noclient:${dm.accountId}:${dm.deviceId}`)) {
        songloft.log.warn(
          `[ConversationMonitor] No Mina client for account=${dm.accountId} device=${dm.deviceId}; skip poll (login may still be in progress)`,
        );
      }
      return;
    }

    let askMessages: AskMessage[] | null;
    let timeoutId: any = null;
    const pollRequestId = `${runGeneration}:${++this.pollRequestSequence}`;
    try {
      // Older Songloft QuickJS hosts do not expose AbortController. The race
      // below still bounds the monitor even when the underlying request cannot
      // be actively cancelled.
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const pollResult = await Promise.race([
        client.getLatestAskFromXiaoai(dm.deviceId, dm.hardware, 5, controller?.signal, pollRequestId).then(
          messages => ({ kind: 'result' as const, messages }),
          error => ({ kind: 'error' as const, error }),
        ),
        new Promise<{ kind: 'timeout' }>(resolve => {
          timeoutId = setTimeout(() => {
            controller?.abort();
            resolve({ kind: 'timeout' });
          }, ConversationMonitor.DEVICE_POLL_TIMEOUT_MS);
        }),
      ]);
      if (pollResult.kind === 'timeout') {
        dm.lastError = `拉对话超时（${ConversationMonitor.DEVICE_POLL_TIMEOUT_MS / 1000}s）`;
        dm.lastPollAtMs = Date.now();
        // AbortController is absent on older QuickJS hosts. MinaHTTPClient
        // still exposes an explicit conversation-slot release so a hung UBus
        // request cannot block the next polling round forever.
        if (typeof client.cancelConversationPoll === 'function') {
          client.cancelConversationPoll(dm.deviceId, pollRequestId);
        }
        if (this.isRunCurrent(runGeneration) && this.shouldDiagWarn(`timeout:${dm.deviceId}`)) {
          songloft.log.warn(
            `[ConversationMonitor] Conversation poll timed out: ${dm.deviceId} after ${ConversationMonitor.DEVICE_POLL_TIMEOUT_MS}ms`,
          );
        }
        return;
      }
      if (pollResult.kind === 'error') {
        throw pollResult.error;
      }
      askMessages = pollResult.messages;
    } catch (e) {
      dm.lastError = `拉对话异常: ${String(e)}`;
      dm.lastPollAtMs = Date.now();
      if (this.isRunCurrent(runGeneration) && this.shouldDiagWarn(`fetcherr:${dm.deviceId}`)) {
        songloft.log.warn(`[ConversationMonitor] Failed to get conversations: ${dm.deviceId} ${String(e)}`);
      }
      return;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    if (!this.isRunCurrent(runGeneration) || !dm.isRunning) {
      return;
    }

    dm.lastPollAtMs = Date.now();

    if (askMessages === null) {
      dm.lastError = `拉对话失败 hardware=${dm.hardware || '(空)'}（token/网络/型号，详见日志 ConversationMonitor）`;
      if (this.shouldDiagWarn(`null:${dm.deviceId}`)) {
        songloft.log.warn(
          `[ConversationMonitor] Conversation fetch returned null device=${dm.deviceId} hardware=${dm.hardware || '(empty)'} primed=${dm.primed}; will retry`,
        );
      }
      return;
    }

    // 成功拿到结果（含空数组）即清除错误
    dm.lastError = '';

    // Quiet when empty — default poll is 1s; do not emit info spam for zero results.
    const msgCount = askMessages.length;
    if (msgCount > 0) {
      const summary = askMessages.map(m => {
        const q = m.response?.answer?.[0]?.question ?? '?';
        return `[ts=${m.timestamp_ms} q="${q.substring(0, 50)}"]`;
      }).join(', ');
      songloft.log.info(`[ConversationMonitor] pollDevice device=${dm.deviceId} returned ${msgCount} messages: ${summary}`);
    }

    if (!dm.primed) {
      dm.lastTimestampMs = askMessages.reduce(
        (max, message) => Math.max(max, message.timestamp_ms),
        0,
      );
      dm.primed = true;
      songloft.log.info(
        `[ConversationMonitor] Baseline primed device=${dm.deviceId} name=${dm.deviceName} lastTimestampMs=${dm.lastTimestampMs} (from ${askMessages.length} records, not delivered as new)`,
      );
      return;
    }

    if (askMessages.length === 0) {
      return;
    }

    // 按时间戳去重：只保留比 lastTimestampMs 更新的消息
    const newMessages: ConversationMessage[] = [];
    let maxTimestamp = dm.lastTimestampMs;

    for (const askMsg of askMessages) {
      if (askMsg.timestamp_ms > dm.lastTimestampMs) {
        // 构造完整的 ConversationMessage（与 WASM 版一致）
        const convMsg: ConversationMessage = {
          account_id: dm.accountId,
          device_id: dm.deviceId,
          device_name: dm.deviceName,
          message: askMsg,
        };
        newMessages.push(convMsg);
        if (askMsg.timestamp_ms > maxTimestamp) {
          maxTimestamp = askMsg.timestamp_ms;
        }
      }
    }

    // Only log when there is something new to process.
    if (newMessages.length === 0) {
      return;
    }
    if (!this.isRunCurrent(runGeneration) || !dm.isRunning) {
      return;
    }
    songloft.log.info(
      `[ConversationMonitor] pollDevice device=${dm.deviceId} after filter: ${newMessages.length} new (lastTimestampMs=${dm.lastTimestampMs})`,
    );

    // 更新最后时间戳
    dm.lastTimestampMs = maxTimestamp;

    // 追加到全局消息缓冲区
    for (const msg of newMessages) {
      const q = msg.message?.response?.answer?.[0]?.question ?? '?';
      const a = msg.message?.response?.answer?.[0]?.content ?? '?';
      songloft.log.info(`[ConversationMonitor] addMessage ts=${msg.message.timestamp_ms} q="${q.substring(0, 80)}" a="${a.substring(0, 80)}"`);
      this.addMessage(msg);
    }

    songloft.log.info(`[ConversationMonitor] New messages account=${dm.accountId} device=${dm.deviceId} count=${newMessages.length}`);

    // 触发所有内部回调
    await this.notifyCallbacks(newMessages);

    // 向所有 Webhook 推送
    if (this.isRunCurrent(runGeneration) && dm.isRunning) {
      await this.triggerWebhooks(dm.accountId, dm.deviceId, dm.deviceName, newMessages);
    }
  }

  /**
   * 添加消息到环形缓冲区
   */
  private addMessage(msg: ConversationMessage): void {
    this.messages.push(msg);
    // 超过容量时移除最旧的消息
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages);
    }
  }

  /**
   * 触发所有已注册的内部回调
   */
  private async notifyCallbacks(messages: ConversationMessage[]): Promise<void> {
    for (const [name, cb] of this.callbacks.entries()) {
      try {
        for (const msg of messages) {
          await cb(msg);
        }
      } catch (e) {
        songloft.log.error(`[ConversationMonitor] Callback error name=${name}: ${String(e)}`);
      }
    }
  }

  /**
   * 触发 Webhook 推送
   * Independent webhooks run in parallel with timeout; one failure does not block others.
   */
  private async triggerWebhooks(accountId: string, deviceId: string, deviceName: string, messages: ConversationMessage[]): Promise<void> {
    const webhooks = await this.configManager.getWebhooks();
    if (webhooks.length === 0) {
      return;
    }

    const payload = JSON.stringify({
      account_id: accountId,
      device_id: deviceId,
      device_name: deviceName,
      messages,
    });

    const results = await Promise.allSettled(
      webhooks.map((wh) => this.sendWebhook(wh, payload)),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const wh = webhooks[i];
        songloft.log.warn(
          `[ConversationMonitor] Webhook failed id=${wh?.id} url=${wh?.url}: ${String(result.reason)}`,
        );
      }
    }
  }

  /**
   * 向单个 Webhook URL 发送 POST 请求（带超时）
   */
  private async sendWebhook(wh: WebhookConfig, payload: string): Promise<void> {
    // Re-validate at delivery: entries stored before the URL rules tightened
    // must not become a standing SSRF path into the host network.
    const validated = validateOutboundWebhookUrl(wh.url);
    if (!validated.ok) {
      throw new Error(`webhook url rejected: ${validated.error}`);
    }

    const timeoutMs = ConversationMonitor.WEBHOOK_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let response: Response;
      if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), timeoutMs);
        response = await fetch(validated.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
          redirect: 'manual',
        });
      } else {
        response = await Promise.race([
          fetch(validated.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            redirect: 'manual',
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('webhook timeout')), timeoutMs);
          }),
        ]);
      }
      if (response && response.ok === false) {
        throw new Error(`webhook responded ${response.status}`);
      }
      songloft.log.info(`[ConversationMonitor] Webhook sent id=${wh.id} url=${wh.url}`);
    } catch (e) {
      songloft.log.warn(`[ConversationMonitor] Webhook failed id=${wh.id} url=${wh.url}: ${String(e)}`);
      throw e;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * 生成设备唯一键
   */
  private makeKey(accountId: string, deviceId: string): string {
    return accountId + ':' + deviceId;
  }

  private isRunCurrent(runGeneration: number): boolean {
    return this.enabled && this.runGeneration === runGeneration;
  }

  private isRefreshCurrent(runGeneration: number, refreshSequence: number): boolean {
    return this.isRunCurrent(runGeneration) && this.refreshSequence === refreshSequence;
  }
}
