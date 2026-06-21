// MIoT 智能音箱插件 - 定时任务调度器
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/schedule/scheduler.go
// 实现 30s tick 循环，分钟级去重，weekly/monthly 调度匹配

/// <reference types="@songloft/plugin-sdk" />

import { ConfigManager } from '../config/manager';
import type { ScheduledTask, TaskSchedule, TaskLog } from '../types';
import { TaskExecutor } from './executor';
import { lookupHoliday } from '../utils/holiday';

/** tick 间隔 30 秒 */
const TICK_INTERVAL_MS = 30000;

/** 内存中最多保留 200 条执行日志 */
const MAX_LOGS = 200;

/**
 * Scheduler - 定时任务调度器
 * 每 30 秒检查一次当前时间，匹配已启用的定时任务并执行
 * 使用分钟级去重防止同一分钟内多次执行
 */
export class Scheduler {
  private configManager: ConfigManager;
  private executor: TaskExecutor;
  private tickTimer: any = null;
  private lastExecutedMinute: string = '';
  private enabled: boolean = false;
  private logs: TaskLog[] = [];

  constructor(configManager: ConfigManager, executor: TaskExecutor) {
    this.configManager = configManager;
    this.executor = executor;
  }

  /**
   * 启动调度器
   * 设置 30s setInterval 并立即执行一次 tick
   */
  start(): void {
    if (this.enabled) {
      songloft.log.info('[Scheduler] 调度器已在运行中，跳过启动');
      return;
    }
    this.enabled = true;

    // 启动 30s 周期 tick
    this.tickTimer = setInterval(() => {
      this.tick().catch(e => {
        songloft.log.error('[Scheduler] tick error: ' + String(e));
      });
    }, TICK_INTERVAL_MS);

    // 立即执行一次
    this.tick().catch(e => {
      songloft.log.error('[Scheduler] initial tick error: ' + String(e));
    });

    songloft.log.info('[Scheduler] 定时任务调度器已启动');
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;

    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    songloft.log.info('[Scheduler] 定时任务调度器已停止');
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.enabled;
  }

  /**
   * 获取执行日志（最近 limit 条，0 表示全部）
   */
  getLogs(limit?: number): TaskLog[] {
    const effectiveLimit = (limit && limit > 0 && limit < this.logs.length)
      ? limit
      : this.logs.length;
    // 返回最新的日志（尾部是最新的）
    const start = this.logs.length - effectiveLimit;
    return this.logs.slice(start);
  }

  /**
   * 单次 tick：检查当前时间是否有任务需要执行
   */
  private async tick(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const now = new Date();
    const currentMinute = this.formatMinute(now);

    // 分钟级去重：同一分钟只处理一次
    if (currentMinute === this.lastExecutedMinute) {
      return;
    }
    this.lastExecutedMinute = currentMinute;

    // 获取当前时间信息
    const timeStr = this.formatTime(now); // "HH:MM"
    const weekday = now.getDay();          // 0=Sun, 1=Mon...6=Sat
    const monthday = now.getDate();        // 1-31

    // 获取所有已启用的定时任务
    const tasks = await this.configManager.getScheduledTasks();
    for (const task of tasks) {
      if (!task.enabled) {
        continue;
      }
      if (task.schedule.time !== timeStr) {
        continue;
      }
      if (!this.matchSchedule(task.schedule, weekday, monthday, now)) {
        continue;
      }

      songloft.log.info(
        `[Scheduler] 定时任务触发 task_id=${task.id} name=${task.name} action=${task.action} time=${timeStr}`
      );

      // 执行任务
      const logs = await this.executor.execute(task);
      for (const log of logs) {
        await this.appendLog(log);
      }
    }
  }

  /**
   * 判断当前时间是否匹配调度配置
   */
  private matchSchedule(schedule: TaskSchedule, weekday: number, monthday: number, now: Date): boolean {
    switch (schedule.type) {
      case 'weekly':
        return this.matchWeekly(schedule, weekday, now);
      case 'monthly':
        return this.matchMonthly(schedule, monthday);
      default:
        songloft.log.warn('[Scheduler] 未知的调度类型: ' + schedule.type);
        return false;
    }
  }

  /**
   * 匹配 weekly 调度，含可选的节假日感知:
   * - holiday_mode='ignore' (默认): 仅按 weekdays 判定
   * - holiday_mode='only_holiday': 必须是法定放假日,且 weekday 在勾选范围
   * - holiday_mode='exclude_holiday': 调休补班日强制触发(无视 weekday);
   *   法定假日跳过;普通日按 weekdays 判定
   */
  private matchWeekly(schedule: TaskSchedule, weekday: number, now: Date): boolean {
    const inWeekday = !!schedule.weekdays && schedule.weekdays.includes(weekday);
    const mode = schedule.holiday_mode || 'ignore';
    const holiday = mode === 'ignore' ? undefined : lookupHoliday(now);

    if (mode === 'only_holiday') {
      if (!holiday || !holiday.isOffDay) return false;
      return inWeekday;
    }
    if (mode === 'exclude_holiday') {
      if (holiday && !holiday.isOffDay) return true;   // 补班日强制触发
      if (holiday && holiday.isOffDay) return false;   // 法定假跳过
      return inWeekday;                                 // 普通日按 weekday
    }
    return inWeekday;
  }

  /**
   * 匹配 monthly 调度：检查当前几号是否在 monthdays 列表中
   */
  private matchMonthly(schedule: TaskSchedule, monthday: number): boolean {
    if (!schedule.monthdays || schedule.monthdays.length === 0) {
      return false;
    }
    return schedule.monthdays.includes(monthday);
  }

  /**
   * 追加执行日志到环形缓冲区
   */
  private async appendLog(log: TaskLog): Promise<void> {
    this.logs.push(log);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
    }
    // 同时持久化到 configManager
    await this.configManager.addScheduleLog(log);
  }

  /**
   * 格式化为分钟标识 "YYYY-MM-DD HH:MM"（用于去重）
   */
  private formatMinute(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
  }

  /**
   * 格式化为时间 "HH:MM"（用于与 task.schedule.time 比较）
   */
  private formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  }
}
