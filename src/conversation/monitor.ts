// MIoT 智能音箱插件 - 对话监听器
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/conversation/monitor.go
// 定时轮询设备对话记录，支持回调通知和 Webhook 推送

/// <reference types="@songloft/plugin-sdk" />

import { AccountManager } from '../account/manager';
import { ConfigManager } from '../config/manager';
import type { ConversationMessage, AskMessage, WebhookConfig } from '../types';
import { MinaHTTPClient } from '../mina/client';

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
  isRunning: boolean;
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

  constructor(accountManager: AccountManager, configManager: ConfigManager) {
    this.accountManager = accountManager;
    this.configManager = configManager;
  }

  // ===== 公开方法 =====

  /**
   * 启动对话监听
   * 遍历所有 managed 设备，启动定时轮询
   * 回调通过 registerCallback() 独立注册，start() 只管启停
   */
  start(): void {
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

    // 从配置读取轮询间隔，然后刷新设备列表并启动定时器。
    this.configManager.getConfig().then(config => {
      if (!this.enabled) return;

      const intervalSec = Math.max(1, Math.min(30, config.conversation_poll_interval ?? 1));
      this.pollInterval = intervalSec * 1000;

      return this.refreshDevices().then(() => {
        if (!this.enabled) return;

        // 标记所有设备为运行中，并重置时间戳防止重放旧消息。
        const now = Date.now();
        for (const dm of this.devices.values()) {
          dm.isRunning = true;
          dm.lastTimestampMs = now;
        }
        songloft.log.info(`[ConversationMonitor] Started, devices=${this.devices.size} callbacks=${this.callbacks.size} interval=${intervalSec}s timestampReset=${now}`);

        if (this.pollTimer !== null) {
          clearInterval(this.pollTimer);
        }
        this.pollTimer = setInterval(() => {
          this.pollAll().catch(e => {
            songloft.log.error('[ConversationMonitor] pollAll error: ' + String(e));
          });
        }, this.pollInterval);
      });
    }).catch(e => {
      songloft.log.error('[ConversationMonitor] start error: ' + String(e));
    });
  }

  /**
   * 停止对话监听
   */
  stop(): void {
    if (!this.enabled && this.pollTimer === null) {
      return;
    }

    this.enabled = false;

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // 标记所有设备为停止
    for (const dm of this.devices.values()) {
      dm.isRunning = false;
    }

    songloft.log.info(`[ConversationMonitor] Stopped`);
  }

  /**
   * 刷新设备列表：停止已移除设备的监听，启动新增设备的监听
   */
  async refresh(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.refreshDevices();
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
  private async refreshDevices(): Promise<void> {
    const accounts = await this.accountManager.getAccounts();

    // 构建当前 managed 设备的 key 集合
    const managedKeys = new Set<string>();
    const newDevices: Array<{ accountId: string; deviceId: string; deviceName: string; hardware: string }> = [];

    for (const acc of accounts) {
      const managed = await this.accountManager.getManagedDevices(acc.id);
      for (const dev of managed) {
        const key = this.makeKey(acc.id, dev.device_id);
        managedKeys.add(key);
        if (!this.devices.has(key)) {
          newDevices.push({
            accountId: acc.id,
            deviceId: dev.device_id,
            deviceName: dev.device_name,
            hardware: dev.hardware,
          });
        }
      }
    }

    // 移除不再 managed 的设备
    for (const key of this.devices.keys()) {
      if (!managedKeys.has(key)) {
        this.devices.delete(key);
        songloft.log.info(`[ConversationMonitor] Device removed from monitoring: ${key}`);
      }
    }

    // 添加新的 managed 设备
    for (const dev of newDevices) {
      const key = this.makeKey(dev.accountId, dev.deviceId);
      this.devices.set(key, {
        accountId: dev.accountId,
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        hardware: dev.hardware,
        lastTimestampMs: Date.now(),
        isRunning: true,
      });
      songloft.log.info(`[ConversationMonitor] Device added to monitoring: ${dev.deviceName} (${key})`);
    }
  }

  /**
   * 轮询所有设备的对话记录
   */
  private async pollAll(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    for (const dm of this.devices.values()) {
      if (!dm.isRunning) continue;
      await this.pollDevice(dm);
    }
  }

  /**
   * 轮询单个设备
   * 获取对话记录 → 时间戳去重 → 触发回调 → 推送 Webhook
   */
  private async pollDevice(dm: DeviceMonitorState): Promise<void> {
    // 获取 MinaHTTPClient
    const client = this.accountManager.getMinaClient(dm.accountId) as MinaHTTPClient | null;
    if (!client) {
      return;
    }

    // 获取对话记录（返回 AskMessage[]）
    let askMessages: AskMessage[];
    try {
      askMessages = await client.getLatestAskFromXiaoai(dm.deviceId, dm.hardware, 5);
    } catch (e) {
      songloft.log.warn(`[ConversationMonitor] Failed to get conversations: ${dm.deviceId} ${String(e)}`);
      return;
    }

    // 打印返回的消息数量和内容摘要
    const msgCount = askMessages ? askMessages.length : 0;
    if (msgCount > 0) {
      const summary = askMessages.map(m => {
        const q = m.response?.answer?.[0]?.question ?? '?';
        return `[ts=${m.timestamp_ms} q="${q.substring(0, 50)}"]`;
      }).join(', ');
      songloft.log.info(`[ConversationMonitor] pollDevice device=${dm.deviceId} returned ${msgCount} messages: ${summary}`);
    } else {
      songloft.log.info(`[ConversationMonitor] pollDevice device=${dm.deviceId} returned 0 messages`);
    }

    if (!askMessages || askMessages.length === 0) {
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

    // 打印过滤结果
    songloft.log.info(`[ConversationMonitor] pollDevice device=${dm.deviceId} after filter: ${newMessages.length} new (lastTimestampMs=${dm.lastTimestampMs})`);

    if (newMessages.length === 0) {
      return;
    }

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
    await this.triggerWebhooks(dm.accountId, dm.deviceId, dm.deviceName, newMessages);
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
   * 向所有已注册的 Webhook URL 发送 POST 请求
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

    for (const wh of webhooks) {
      await this.sendWebhook(wh, payload);
    }
  }

  /**
   * 向单个 Webhook URL 发送 POST 请求
   */
  private async sendWebhook(wh: WebhookConfig, payload: string): Promise<void> {
    try {
      await fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      songloft.log.info(`[ConversationMonitor] Webhook sent id=${wh.id} url=${wh.url}`);
    } catch (e) {
      songloft.log.warn(`[ConversationMonitor] Webhook failed id=${wh.id} url=${wh.url}: ${String(e)}`);
    }
  }

  /**
   * 生成设备唯一键
   */
  private makeKey(accountId: string, deviceId: string): string {
    return accountId + ':' + deviceId;
  }
}
