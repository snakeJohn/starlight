// MIoT 智能音箱插件 - 配置管理器
// 基于 songloft.storage API 实现配置持久化（异步桥接）

/// <reference types="@songloft/plugin-sdk" />

import type {
  PluginConfig,
  AccountConfig,
  DeviceConfig,
  WebhookConfig,
  VoiceCommand,
  ScheduledTask,
  TaskLog,
  AIConfig,
} from '../types';
import {
  migrateAccountSecrets,
  migrateAISecrets,
  migratePluginSecrets,
} from '../security/credentials';

// ===== 存储键常量 =====
const STORAGE_PREFIX = 'starlight:miot:';
const STORAGE_KEY_CONFIG = STORAGE_PREFIX + 'config';
const STORAGE_KEY_ACCOUNTS = STORAGE_PREFIX + 'accounts';
const STORAGE_KEY_WEBHOOKS = STORAGE_PREFIX + 'webhooks';
const STORAGE_KEY_VOICE_COMMANDS = STORAGE_PREFIX + 'voice_commands';
const STORAGE_KEY_SCHEDULED_TASKS = STORAGE_PREFIX + 'scheduled_tasks';
const STORAGE_KEY_SCHEDULE_LOGS = STORAGE_PREFIX + 'schedule_logs';
const STORAGE_KEY_AI_CONFIG = STORAGE_PREFIX + 'ai_config';

/** 日志最大条数（环形缓冲） */
const MAX_SCHEDULE_LOGS = 200;

/** 默认插件配置 */
function defaultPluginConfig(): PluginConfig {
  return {
    version: '1.0',
    server_host: '',
    timezone: 'Asia/Shanghai',
    conversation_monitor_enabled: false,
    voice_command_enabled: false,
    scheduled_tasks_enabled: false,
    force_mp3: false,
    external_search_enabled: false,
    external_search_url: '',
    external_search_token: '',
    external_search_playlist_id: '',
    external_search_timeout: 6,
    indicator_light_enabled: true,
    default_cover_id: '1732418460076477549',
    touchscreen_lyrics_enabled: false,
    interrupt_tts_hint_enabled: false,
    interrupt_tts_hint_text: '正在搜索，请稍候',
    conversation_poll_interval: 1,
    conversation_poll_debug: false,
    smart_resume_timeout: 30,
    max_song_index: 10000,
    ai_config: defaultAIConfig(),
  };
}

/** 默认 AI 配置 */
function defaultAIConfig(): AIConfig {
  return {
    enabled: false,
    api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: '',
    model: 'qwen-flash',
    timeout: 6,
  };
}

/**
 * 配置管理器
 * 使用 songloft.storage API（异步）实现分键持久化存储
 */
export class ConfigManager {
  /**
   * Per-storage-key write queue so concurrent read-modify-write updates on the
   * same key (accounts / schedules / webhooks / …) cannot clobber each other.
   */
  private writeQueues = new Map<string, Promise<void>>();

  /** Serialize async work for a single storage key. */
  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const chained = previous.catch(() => {}).then(() => gate);
    this.writeQueues.set(key, chained);
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.writeQueues.get(key) === chained) {
        this.writeQueues.delete(key);
      }
    }
  }

  // ===== 通用存储读写 =====

  /** 从storage读取JSON数据，不存在则返回默认值 */
  private async load<T>(key: string, defaultValue: T): Promise<T> {
    const raw = await songloft.storage.get(key);
    if (raw === null || raw === undefined || raw === '') {
      return defaultValue;
    }
    try {
      return JSON.parse(raw as string) as T;
    } catch {
      return defaultValue;
    }
  }

  /** 将JSON数据写入storage */
  private async save<T>(key: string, value: T): Promise<void> {
    await songloft.storage.set(key, JSON.stringify(value));
  }

  /**
   * Atomic read-modify-write for a storage key.
   * Callers that load → mutate → save the same array should use this to avoid
   * lost updates under concurrent requests.
   */
  private async mutate<T>(key: string, defaultValue: T, mutator: (current: T) => T | Promise<T>): Promise<T> {
    return this.withKeyLock(key, async () => {
      const current = await this.load<T>(key, defaultValue);
      const next = await mutator(current);
      await this.save(key, next);
      return next;
    });
  }

  // ===== 全局配置 =====

  /** 获取插件全局配置（与默认值合并，确保新增字段有默认值） */
  async getConfig(): Promise<PluginConfig> {
    const stored = await this.load<Partial<PluginConfig>>(STORAGE_KEY_CONFIG, {});
    return migratePluginSecrets({ ...defaultPluginConfig(), ...stored });
  }

  /** 保存插件全局配置 */
  async saveConfig(config: PluginConfig): Promise<void> {
    await this.save(STORAGE_KEY_CONFIG, config);
  }

  // ===== 账号管理（存储层） =====

  /** 获取所有账号配置 */
  async getAccounts(): Promise<AccountConfig[]> {
    const accounts = await this.load<AccountConfig[]>(STORAGE_KEY_ACCOUNTS, []);
    return accounts.map(migrateAccountSecrets);
  }

  /** 保存所有账号配置 */
  async saveAccounts(accounts: AccountConfig[]): Promise<void> {
    await this.withKeyLock(STORAGE_KEY_ACCOUNTS, async () => {
      await this.save(STORAGE_KEY_ACCOUNTS, accounts);
    });
  }

  /** 按ID获取单个账号配置 */
  async getAccount(accountId: string): Promise<AccountConfig | null> {
    const accounts = await this.getAccounts();
    return accounts.find(a => a.id === accountId) ?? null;
  }

  /** 添加账号配置（追加） */
  async addAccount(account: AccountConfig): Promise<void> {
    await this.mutate<AccountConfig[]>(STORAGE_KEY_ACCOUNTS, [], (raw) => {
      const accounts = raw.map(migrateAccountSecrets);
      if (accounts.some(a => a.id === account.id)) {
        throw new Error(`Account already exists: ${account.id}`);
      }
      return [...accounts, account];
    });
  }

  /** 更新账号配置（按ID匹配并合并字段） */
  async updateAccount(accountId: string, updates: Partial<AccountConfig>): Promise<void> {
    await this.mutate<AccountConfig[]>(STORAGE_KEY_ACCOUNTS, [], (raw) => {
      const accounts = raw.map(migrateAccountSecrets);
      const idx = accounts.findIndex(a => a.id === accountId);
      if (idx === -1) {
        throw new Error(`Account not found: ${accountId}`);
      }
      const next = accounts.slice();
      next[idx] = { ...next[idx], ...updates, updated_at: new Date().toISOString() };
      return next;
    });
  }

  /** 删除账号配置 */
  async removeAccount(accountId: string): Promise<void> {
    await this.mutate<AccountConfig[]>(STORAGE_KEY_ACCOUNTS, [], (raw) => {
      const accounts = raw.map(migrateAccountSecrets);
      const filtered = accounts.filter(a => a.id !== accountId);
      if (filtered.length === accounts.length) {
        throw new Error(`Account not found: ${accountId}`);
      }
      return filtered;
    });
  }

  // ===== 设备管理（存储层） =====

  /** 获取某账号的设备列表 */
  async getDevices(accountId: string): Promise<DeviceConfig[]> {
    const account = await this.getAccount(accountId);
    return account?.devices ?? [];
  }

  /** 更新某账号下特定设备的配置 */
  async updateDevice(accountId: string, deviceId: string, updates: Partial<DeviceConfig>): Promise<void> {
    await this.mutate<AccountConfig[]>(STORAGE_KEY_ACCOUNTS, [], (raw) => {
      const accounts = raw.map(migrateAccountSecrets);
      const accIdx = accounts.findIndex(a => a.id === accountId);
      if (accIdx === -1) {
        throw new Error(`Account not found: ${accountId}`);
      }
      const devIdx = accounts[accIdx].devices.findIndex(d => d.device_id === deviceId);
      if (devIdx === -1) {
        throw new Error(`Device not found: ${deviceId}`);
      }
      const next = accounts.slice();
      const devices = next[accIdx].devices.slice();
      devices[devIdx] = { ...devices[devIdx], ...updates };
      next[accIdx] = {
        ...next[accIdx],
        devices,
        updated_at: new Date().toISOString(),
      };
      return next;
    });
  }

  /** 设置账号最后选中的设备 */
  async setLastSelectedDevice(accountId: string, deviceId: string): Promise<void> {
    await this.updateAccount(accountId, { last_selected_device_id: deviceId });
  }

  // ===== Webhook管理 =====

  /** 获取所有Webhook配置 */
  async getWebhooks(): Promise<WebhookConfig[]> {
    return this.load<WebhookConfig[]>(STORAGE_KEY_WEBHOOKS, []);
  }

  /** 保存所有Webhook配置 */
  async saveWebhooks(webhooks: WebhookConfig[]): Promise<void> {
    await this.withKeyLock(STORAGE_KEY_WEBHOOKS, async () => {
      await this.save(STORAGE_KEY_WEBHOOKS, webhooks);
    });
  }

  /** 添加Webhook */
  async addWebhook(webhook: WebhookConfig): Promise<void> {
    await this.mutate<WebhookConfig[]>(STORAGE_KEY_WEBHOOKS, [], (webhooks) => {
      if (webhooks.some(w => w.id === webhook.id)) {
        throw new Error(`Webhook already exists: ${webhook.id}`);
      }
      return [...webhooks, webhook];
    });
  }

  /** 删除Webhook */
  async removeWebhook(webhookId: string): Promise<void> {
    await this.mutate<WebhookConfig[]>(STORAGE_KEY_WEBHOOKS, [], (webhooks) => {
      const filtered = webhooks.filter(w => w.id !== webhookId);
      if (filtered.length === webhooks.length) {
        throw new Error(`Webhook not found: ${webhookId}`);
      }
      return filtered;
    });
  }

  // ===== 语音口令 =====

  /** 获取语音口令配置 */
  async getVoiceCommands(): Promise<VoiceCommand[]> {
    return this.load<VoiceCommand[]>(STORAGE_KEY_VOICE_COMMANDS, []);
  }

  /** 保存语音口令配置 */
  async saveVoiceCommands(commands: VoiceCommand[]): Promise<void> {
    await this.withKeyLock(STORAGE_KEY_VOICE_COMMANDS, async () => {
      await this.save(STORAGE_KEY_VOICE_COMMANDS, commands);
    });
  }

  // ===== AI 配置 =====

  /** 获取 AI 配置 */
  async getAIConfig(): Promise<AIConfig> {
    const ai = await this.load<AIConfig>(STORAGE_KEY_AI_CONFIG, defaultAIConfig());
    return migrateAISecrets({ ...defaultAIConfig(), ...ai });
  }

  /** 保存 AI 配置 */
  async saveAIConfig(config: AIConfig): Promise<void> {
    await this.withKeyLock(STORAGE_KEY_AI_CONFIG, async () => {
      await this.save(STORAGE_KEY_AI_CONFIG, config);
    });
  }

  // ===== 定时任务 =====

  /** 获取所有定时任务 */
  async getScheduledTasks(): Promise<ScheduledTask[]> {
    return this.load<ScheduledTask[]>(STORAGE_KEY_SCHEDULED_TASKS, []);
  }

  /** 保存所有定时任务 */
  async saveScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
    await this.withKeyLock(STORAGE_KEY_SCHEDULED_TASKS, async () => {
      await this.save(STORAGE_KEY_SCHEDULED_TASKS, tasks);
    });
  }

  /** 添加定时任务 */
  async addScheduledTask(task: ScheduledTask): Promise<void> {
    await this.mutate<ScheduledTask[]>(STORAGE_KEY_SCHEDULED_TASKS, [], (tasks) => {
      if (tasks.some(t => t.id === task.id)) {
        throw new Error(`Scheduled task already exists: ${task.id}`);
      }
      return [...tasks, task];
    });
  }

  /** 更新定时任务（按ID匹配并合并字段） */
  async updateScheduledTask(taskId: string, updates: Partial<ScheduledTask>): Promise<void> {
    await this.mutate<ScheduledTask[]>(STORAGE_KEY_SCHEDULED_TASKS, [], (tasks) => {
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx === -1) {
        throw new Error(`Scheduled task not found: ${taskId}`);
      }
      const next = tasks.slice();
      next[idx] = { ...next[idx], ...updates, updated_at: new Date().toISOString() };
      return next;
    });
  }

  /** 删除定时任务 */
  async removeScheduledTask(taskId: string): Promise<void> {
    await this.mutate<ScheduledTask[]>(STORAGE_KEY_SCHEDULED_TASKS, [], (tasks) => {
      const filtered = tasks.filter(t => t.id !== taskId);
      if (filtered.length === tasks.length) {
        throw new Error(`Scheduled task not found: ${taskId}`);
      }
      return filtered;
    });
  }

  // ===== 执行日志 =====

  /** 获取所有执行日志 */
  async getScheduleLogs(): Promise<TaskLog[]> {
    return this.load<TaskLog[]>(STORAGE_KEY_SCHEDULE_LOGS, []);
  }

  /** 添加执行日志（环形缓冲，最多200条，超出删除最旧的） */
  async addScheduleLog(log: TaskLog): Promise<void> {
    await this.mutate<TaskLog[]>(STORAGE_KEY_SCHEDULE_LOGS, [], (logs) => {
      const next = logs.concat(log);
      while (next.length > MAX_SCHEDULE_LOGS) {
        next.shift();
      }
      return next;
    });
  }
}
