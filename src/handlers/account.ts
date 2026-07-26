// MIoT 智能音箱插件 - 账号管理 Handler

import { parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { AccountManager } from '../account/manager';
import { migrateAccountSecrets, toPublicAccount } from '../security/credentials';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { runApi } from '../system/response';

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
  router.post('/accounts', async (req: HTTPRequest) =>
    runApi(async () => {
      const body = parseJsonBody<{ account?: string; auth_type?: string }>(req);
      if (!body.account) {
        throw new StarlightError('BAD_REQUEST', 'account is required');
      }
      const acc = await accountManager.createAccount(body.account, body.auth_type || 'password');
      return toPublicAccount(migrateAccountSecrets(acc));
    }));

  router.get('/accounts', async () =>
    runApi(async () => {
      const accounts = await accountManager.getAccounts();
      return accounts.map((a) => toPublicAccount(migrateAccountSecrets(a)));
    }));

  router.get('/account', async (req: HTTPRequest) =>
    runApi(async () => {
      const query = parseQuery(req.query);
      const accountId = query.account_id;
      if (!accountId) {
        throw new StarlightError('BAD_REQUEST', 'account_id is required');
      }
      const acc = await accountManager.getAccount(accountId);
      if (!acc) {
        throw new StarlightError('BAD_REQUEST', 'account not found');
      }
      return toPublicAccount(migrateAccountSecrets(acc));
    }));

  router.delete('/account', async (req: HTTPRequest) =>
    runApi(async () => {
      const query = parseQuery(req.query);
      const accountId = query.account_id;
      if (!accountId) {
        throw new StarlightError('BAD_REQUEST', 'account_id is required');
      }
      await accountManager.deleteAccount(accountId);
      return { message: 'account deleted' };
    }));
}
