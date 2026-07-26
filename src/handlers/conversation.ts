// MIoT 智能音箱插件 - 对话监听 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/conversation_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { ConversationMonitor } from '../conversation/monitor';
import { ConfigManager } from '../config/manager';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { validateOutboundWebhookUrl } from '../utils/url_safety';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 500;

/** 解析 limit 查询参数：非法值（NaN/负数/0）会让 getMessages 退化成"返回全部"，必须回落到默认值 */
function parseMessageLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_MESSAGE_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(parsed, MAX_MESSAGE_LIMIT);
}

/**
 * 注册对话监听相关路由
 * GET    /conversation/messages  → 获取对话记录
 * POST   /conversation/messages/clear → 清空插件缓存的对话记录
 * GET    /conversation/status    → 获取监听状态
 * POST   /conversation/webhooks  → 注册Webhook
 * GET    /conversation/webhooks  → 获取Webhook列表
 * DELETE /conversation/webhooks  → 删除Webhook
 */
export function registerConversationHandlers(
  router: Router,
  conversationMonitor: ConversationMonitor,
  configManager: ConfigManager,
): void {

  // GET /conversation/messages - 获取对话记录
  router.get('/conversation/messages', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const limit = parseMessageLimit(query.limit);
      const rawSince = query.since ? Number(query.since) : 0;
      const sinceMs = Number.isFinite(rawSince) && rawSince > 0 ? rawSince : 0;

      const messages = conversationMonitor.getMessages(limit, sinceMs);
      return jsonResponse({ success: true, data: messages, count: messages.length });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /conversation/messages/clear - 清空插件内存缓存，不删除米家云端历史
  router.post('/conversation/messages/clear', async () => {
    try {
      const cleared = conversationMonitor.clearMessages();
      return jsonResponse({ success: true, data: { cleared } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /conversation/status - 获取监听状态
  router.get('/conversation/status', async () => {
    try {
      const status = await conversationMonitor.getStatus();
      return jsonResponse({ success: true, data: status });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /conversation/webhooks - 注册Webhook
  router.post('/conversation/webhooks', async (req: HTTPRequest) => {
    try {
      const body = parseJsonBody<any>(req);
      const { url, name } = body;
      const validated = validateOutboundWebhookUrl(url);
      if (!validated.ok) {
        return jsonResponse({ success: false, error: validated.error });
      }

      const webhook = {
        id: 'wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        url: validated.url,
        name: name || '',
      };

      await configManager.addWebhook(webhook);
      return jsonResponse({ success: true, data: webhook });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /conversation/webhooks - 获取Webhook列表
  router.get('/conversation/webhooks', async () => {
    try {
      const webhooks = await configManager.getWebhooks();
      return jsonResponse({ success: true, data: webhooks, count: webhooks.length });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // DELETE /conversation/webhooks - 删除Webhook
  router.delete('/conversation/webhooks', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const webhookId = query.id;
      if (!webhookId) {
        return jsonResponse({ success: false, error: 'id is required' });
      }
      await configManager.removeWebhook(webhookId);
      return jsonResponse({ success: true, data: { message: 'webhook deleted', id: webhookId } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
