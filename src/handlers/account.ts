// MIoT 智能音箱插件 - 账号管理 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/account_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { AccountManager } from '../account/manager';
import { migrateAccountSecrets, toPublicAccount } from '../security/credentials';

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
 * 注册账号管理相关路由
 * POST /accounts       → 创建账号
 * GET  /accounts       → 获取账号列表
 * GET  /account        → 获取单个账号
 * DELETE /account      → 删除账号
 */
export function registerAccountHandlers(
  router: Router,
  accountManager: AccountManager,
): void {

  // POST /accounts - 创建账号
  router.post('/accounts', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account, auth_type } = body;
      if (!account) {
        return jsonResponse({ success: false, error: 'account is required' });
      }
      const acc = await accountManager.createAccount(account, auth_type || 'password');
      return jsonResponse({ success: true, data: toPublicAccount(migrateAccountSecrets(acc)) });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /accounts - 获取账号列表（显式 DTO，不含密钥）
  router.get('/accounts', async () => {
    try {
      const accounts = await accountManager.getAccounts();
      const safeAccounts = accounts.map((a) => toPublicAccount(migrateAccountSecrets(a)));
      return jsonResponse({ success: true, data: safeAccounts });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /account - 获取单个账号
  router.get('/account', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const accountId = query.account_id;
      if (!accountId) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      const acc = await accountManager.getAccount(accountId);
      if (!acc) {
        return jsonResponse({ success: false, error: 'account not found' });
      }
      return jsonResponse({
        success: true,
        data: toPublicAccount(migrateAccountSecrets(acc)),
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // DELETE /account - 删除账号
  router.delete('/account', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const accountId = query.account_id;
      if (!accountId) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      await accountManager.deleteAccount(accountId);
      return jsonResponse({ success: true, data: { message: 'account deleted' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
