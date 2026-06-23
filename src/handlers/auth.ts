// MIoT 智能音箱插件 - 认证 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/auth_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { AuthService } from '../auth/service';

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
 * 注册认证相关路由
 * POST /auth/login       → 密码登录
 * POST /auth/captcha     → 提交图形验证码
 * POST /auth/verify      → 提交短信验证码
 * POST /auth/token       → 手动设置Token
 * GET  /auth/status      → 获取认证状态
 * POST /auth/qrcode      → 启动扫码登录
 * POST /auth/qrcode/poll → 轮询扫码状态
 * POST /auth/relogin     → 强制重新登录
 */
export function registerAuthHandlers(
  router: Router,
  authService: AuthService,
): void {

  // POST /auth/login - 密码登录
  router.post('/auth/login', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, username, password } = body;
      if (!username || !password) {
        return jsonResponse({ success: false, error: 'username and password are required' });
      }
      const accountId = account_id || username;
      const result = await authService.login(accountId, username, password);
      return jsonResponse({ success: true, ...result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/captcha - 提交图形验证码
  router.post('/auth/captcha', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, captcha } = body;
      if (!account_id || !captcha) {
        return jsonResponse({ success: false, error: 'account_id and captcha are required' });
      }
      const result = await authService.submitCaptcha(account_id, captcha);
      return jsonResponse({ success: true, ...result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/verify - 提交短信/邮箱验证码
  router.post('/auth/verify', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, code } = body;
      if (!account_id || !code) {
        return jsonResponse({ success: false, error: 'account_id and code are required' });
      }
      const result = await authService.submitVerifyCode(account_id, code);
      return jsonResponse({ success: true, ...result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/token - 手动设置Token
  router.post('/auth/token', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, user_id, pass_token } = body;
      if (!user_id || !pass_token) {
        return jsonResponse({ success: false, error: 'user_id and pass_token are required' });
      }
      const accountId = account_id || user_id;
      const result = await authService.setToken(accountId, pass_token, user_id);
      return jsonResponse({ success: true, ...result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /auth/status - 获取认证状态
  router.get('/auth/status', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const accountId = query.account_id;
      if (accountId) {
        const status = await authService.getAuthStatus(accountId);
        return jsonResponse({ success: true, data: [status] });
      }
      const statuses = await authService.getAllAuthStatus();
      return jsonResponse({ success: true, data: statuses });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/qrcode - 启动扫码登录
  router.post('/auth/qrcode', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const accountId = body.account_id || ('qr_' + Date.now());
      const result = await authService.startQRCodeLogin(accountId);
      if (!result) {
        return jsonResponse({ success: false, error: 'failed to get QR code' });
      }
      return jsonResponse({
        success: true,
        account_id: accountId,
        qrcode_url: result.qrcodeUrl,
        login_url: result.loginUrl,
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/qrcode/poll - 轮询扫码状态
  router.post('/auth/qrcode/poll', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      const result = await authService.pollQRCode(account_id);
      // 将内部状态映射为前端期望的状态名
      const stateMap: Record<string, string> = {
        'confirmed': 'success',
        'failed': 'error',
      };
      const frontendState = stateMap[result.state] || result.state;
      // 不将 tokenInfo 返回给前端（包含敏感信息，且前端不需要）
      // 扫码成功时返回实际的 account_id（userId），前端需要用它替换临时 ID
      const resp: Record<string, any> = { success: true, state: frontendState, message: result.message };
      if (result.account_id) {
        resp.account_id = result.account_id;
      }
      return jsonResponse(resp);
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /auth/relogin - 强制重新登录
  router.post('/auth/relogin', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      const result = await authService.relogin(account_id);
      return jsonResponse({ success: true, ...result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
