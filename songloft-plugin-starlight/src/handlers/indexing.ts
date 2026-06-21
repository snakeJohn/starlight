// MIoT 智能音箱插件 - 索引管理 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/indexing_handler.go

import { jsonResponse } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { IndexingManager } from '../indexing/manager';

/**
 * 注册索引管理相关路由
 * GET  /indexing/status  → 获取索引状态
 * POST /indexing/refresh → 刷新索引
 */
export function registerIndexingHandlers(
  router: Router,
  indexingManager: IndexingManager,
): void {

  // GET /indexing/status - 获取索引状态
  router.get('/indexing/status', async (req: HTTPRequest) => {
    try {
      const status = indexingManager.getStatus();
      return jsonResponse({ success: true, data: status });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /indexing/refresh - 刷新索引
  router.post('/indexing/refresh', async (req: HTTPRequest) => {
    try {
      // 后台异步刷新，立即返回响应
      indexingManager.refresh().catch(e => {
        // 错误已在内部处理，这里只防止 unhandled rejection
      });
      return jsonResponse({ success: true, data: { message: 'index refresh started' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
