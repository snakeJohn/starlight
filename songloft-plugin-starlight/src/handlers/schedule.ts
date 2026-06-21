// MIoT 智能音箱插件 - 定时任务 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/schedule_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { Scheduler } from '../schedule/scheduler';
import { ConfigManager } from '../config/manager';
import type { ScheduledTask, TaskAction, TaskSchedule, TaskTarget, TaskParams } from '../types';

/** 解析请求体（兼容 Uint8Array 和 string） */
function parseBody(req: HTTPRequest): any {
  if (!req.body) return {};
  try {
    const str = typeof req.body === 'string'
      ? req.body
      : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array));
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/** 验证调度配置 */
function validateSchedule(schedule: TaskSchedule): string | null {
  if (!schedule || !schedule.type) {
    return '调度类型不能为空';
  }
  if (!schedule.time || !/^\d{2}:\d{2}$/.test(schedule.time)) {
    return '时间格式应为 HH:MM';
  }
  if (schedule.type === 'weekly') {
    if (!schedule.weekdays || schedule.weekdays.length === 0) {
      return '每周调度需指定星期几';
    }
  } else if (schedule.type === 'monthly') {
    if (!schedule.monthdays || schedule.monthdays.length === 0) {
      return '每月调度需指定日期';
    }
  } else {
    return '未知的调度类型: ' + schedule.type;
  }
  if (schedule.holiday_mode !== undefined &&
      !['ignore', 'only_holiday', 'exclude_holiday'].includes(schedule.holiday_mode)) {
    return '无效的节假日模式: ' + schedule.holiday_mode;
  }
  return null;
}

/** 验证任务动作参数 */
function validateTaskParams(action: TaskAction, params: TaskParams): string | null {
  switch (action) {
    case 'play_playlist':
    case 'play_playlist_from':
      if (!params.playlist_name && !params.playlist_id) {
        return '播放歌单时必须指定歌单名称或ID';
      }
      break;
    case 'stop':
      // 无需额外参数
      break;
    case 'set_play_mode':
      if (!params.play_mode) {
        return '设置播放模式时必须指定播放模式';
      }
      break;
    case 'set_volume':
      if (params.volume === undefined || params.volume < 0 || params.volume > 100) {
        return '音量值应在 0-100 之间';
      }
      break;
    default:
      return '未知的动作类型: ' + action;
  }
  return null;
}

/** 验证目标设备 */
function validateTaskTarget(target: TaskTarget): string | null {
  if (!target) {
    return '目标设备不能为空';
  }
  if (target.all_managed) {
    return null;
  }
  if (!target.devices || target.devices.length === 0) {
    return '请至少选择一个目标设备';
  }
  // 验证每个设备对象必须包含 device_id
  for (const dev of target.devices) {
    if (!dev || typeof dev !== 'object' || !dev.device_id) {
      return '设备信息必须包含 device_id';
    }
  }
  return null;
}

/**
 * 注册定时任务相关路由
 * GET    /schedules        → 获取定时任务列表
 * POST   /schedules        → 添加定时任务
 * POST   /schedules/update → 更新定时任务
 * DELETE /schedules        → 删除定时任务
 * POST   /schedules/toggle → 启用/禁用定时任务
 * GET    /schedules/logs   → 获取执行日志
 */
export function registerScheduleHandlers(
  router: Router,
  scheduler: Scheduler,
  configManager: ConfigManager,
): void {

  // GET /schedules - 获取定时任务列表
  router.get('/schedules', async (req: HTTPRequest) => {
    try {
      const tasks = await configManager.getScheduledTasks();
      const config = await configManager.getConfig();
      return jsonResponse({
        success: true,
        data: { enabled: config.scheduled_tasks_enabled, tasks },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /schedules - 添加定时任务
  router.post('/schedules', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { name, action, schedule, target, params, enabled } = body;

      // 验证必填字段
      if (!name) {
        return jsonResponse({ success: false, error: '任务名称不能为空' });
      }
      if (!action) {
        return jsonResponse({ success: false, error: '动作类型不能为空' });
      }

      // 验证调度配置
      const scheduleErr = validateSchedule(schedule);
      if (scheduleErr) {
        return jsonResponse({ success: false, error: scheduleErr });
      }

      // 验证动作参数
      const paramsErr = validateTaskParams(action, params || {});
      if (paramsErr) {
        return jsonResponse({ success: false, error: paramsErr });
      }

      // 验证目标设备
      const targetErr = validateTaskTarget(target);
      if (targetErr) {
        return jsonResponse({ success: false, error: targetErr });
      }

      const now = new Date().toISOString();
      const task: ScheduledTask = {
        id: 'task_' + Date.now(),
        name,
        enabled: enabled !== false,
        action,
        schedule,
        target,
        params: params || {},
        created_at: now,
        updated_at: now,
      };

      await configManager.addScheduledTask(task);
      return jsonResponse({ success: true, data: task });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /schedules/update - 更新定时任务
  router.post('/schedules/update', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { id, name, action, schedule, target, params, enabled } = body;

      if (!id) {
        return jsonResponse({ success: false, error: '任务 ID 不能为空' });
      }
      if (!name) {
        return jsonResponse({ success: false, error: '任务名称不能为空' });
      }

      // 验证调度配置
      const scheduleErr = validateSchedule(schedule);
      if (scheduleErr) {
        return jsonResponse({ success: false, error: scheduleErr });
      }

      // 验证动作参数
      if (action) {
        const paramsErr = validateTaskParams(action, params || {});
        if (paramsErr) {
          return jsonResponse({ success: false, error: paramsErr });
        }
      }

      // 验证目标设备
      const targetErr = validateTaskTarget(target);
      if (targetErr) {
        return jsonResponse({ success: false, error: targetErr });
      }

      await configManager.updateScheduledTask(id, {
        name,
        enabled: enabled !== false,
        action,
        schedule,
        target,
        params: params || {},
      });
      return jsonResponse({ success: true, data: { message: 'task updated' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // DELETE /schedules - 删除定时任务
  router.delete('/schedules', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const id = query.id;
      if (!id) {
        return jsonResponse({ success: false, error: '缺少任务 ID 参数' });
      }
      await configManager.removeScheduledTask(id);
      return jsonResponse({ success: true, data: { message: 'task deleted' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /schedules/toggle - 切换定时任务启用状态
  router.post('/schedules/toggle', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { id, enabled } = body;
      if (!id) {
        return jsonResponse({ success: false, error: '缺少任务 ID' });
      }
      await configManager.updateScheduledTask(id, { enabled: !!enabled });
      return jsonResponse({ success: true, data: { message: 'task toggled' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /schedules/logs - 获取执行日志
  router.get('/schedules/logs', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const limit = query.limit ? Number(query.limit) : 50;
      const logs = scheduler.getLogs(limit);
      return jsonResponse({ success: true, data: { logs, total: logs.length } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
