// MIoT 智能音箱插件 - 对话监听 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/conversation_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { ConversationMonitor } from '../conversation/monitor';
import { ConfigManager } from '../config/manager';

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
      const limit = query.limit ? Number(query.limit) : 50;
      const sinceMs = query.since ? Number(query.since) : 0;

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
      const body = parseBody(req);
      const { url, name } = body;
      if (!url) {
        return jsonResponse({ success: false, error: 'url is required' });
      }

      const webhook = {
        id: 'wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        url,
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
