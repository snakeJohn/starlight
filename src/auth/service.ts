// MIoT 智能音箱插件 - 认证服务层
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/auth/service.go
// 认证系统的编排层，协调 MinaAuth、QRCodeLogin、AccountManager 完成完整的认证流程

import { MinaAuth } from '../mina/auth';
import { MinaHTTPClient } from '../mina/client';
import { QRCodeLogin, PollResult } from '../qrcode/qrcode';
import { ConfigManager } from '../config/manager';
import { AccountManager } from '../account/manager';
import { LoginSession, SessionManager } from './session';
import { md5 } from '../utils/crypto';
import {
  MINA_SID,
  TOKEN_REFRESH_THRESHOLD_HOURS,
  LoginState,
} from '../mina/constants';
import type { LoginStateType } from '../mina/constants';
import type { XiaomiTokenInfo, LoginResult } from '../types';

/** 同一账号重登录最小间隔（毫秒） */
const RELOGIN_MIN_INTERVAL_MS = 60 * 1000;

/** Token 刷新定时器间隔（毫秒）= 2小时 */
const TOKEN_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * AuthService - 认证服务
 * 协调 MinaAuth、QRCodeLogin、AccountManager 完成完整的认证流程
 * 管理 Token 生命周期：定时刷新、失效回调、自动登录
 */
export class AuthService {
  private configManager: ConfigManager;
  private accountManager: AccountManager;
  private sessionManager: SessionManager;
  private qrLogins: Map<string, QRCodeLogin>;     // accountId → QRCodeLogin
  private refreshTimers: Map<string, any>;          // accountId → timer ID
  private lastReloginTime: Map<string, number>;     // accountId → timestamp（60s间隔保护）

  constructor(configManager: ConfigManager, accountManager: AccountManager) {
    this.configManager = configManager;
    this.accountManager = accountManager;
    this.sessionManager = new SessionManager();
    this.qrLogins = new Map();
    this.refreshTimers = new Map();
    this.lastReloginTime = new Map();
  }

  // ===== 密码登录 =====

  /**
   * 密码登录
   * 1. 确保账号存在
   * 2. 创建 MinaAuth 执行3步登录
   * 3. 根据结果处理验证码/短信验证/成功/失败
   */
  async login(accountId: string, username: string, password: string): Promise<LoginResult> {
    // 确保账号存在
    await this.ensureAccountExists(accountId, username);

    // 创建 MinaAuth 实例和登录会话
    const auth = new MinaAuth();
    const session = this.sessionManager.getOrCreateSession(accountId);
    session.reset();
    session.username = username;
    session.password = md5(password).toUpperCase();
    session.auth = auth;

    // 执行登录
    const result = await auth.login(username, password);

    // 处理登录结果
    if (result.state === LoginState.NEED_CAPTCHA) {
      session.state = 'need_captcha';
      session.captchaUrl = result.captchaImage || '';
      return {
        state: 'need_captcha',
        message: '需要图形验证码',
        captcha_url: result.captchaImage,
      };
    }

    if (result.state === LoginState.NEED_VERIFY) {
      session.state = 'need_verify';
      session.notificationUrl = result.verifyUrl || '';
      return {
        state: 'need_verify',
        message: '需要短信/邮箱验证码',
        notification_url: result.verifyUrl,
      };
    }

    if (result.state === LoginState.SUCCESS && result.tokenInfo) {
      session.state = 'success';
      this.sessionManager.deleteSession(accountId);

      // 创建 MinaHTTPClient 并保存
      await this.setupMinaClient(accountId, result.tokenInfo);

      // 保存密码和登录方式
      await this.configManager.updateAccount(accountId, {
        password,
        login_method: 'password',
      });

      // 保存 token 信息
      await this.saveTokenInfo(accountId, result.tokenInfo);

      return { state: 'success', message: '登录成功' };
    }

    // 登录失败
    session.state = 'failed';
    session.errorMessage = result.error || '未知错误';
    this.sessionManager.deleteSession(accountId);
    return { state: 'failed', message: result.error || '登录失败' };
  }

  // ===== 验证码提交 =====

  /**
   * 提交图形验证码
   * 从 session 恢复之前的 MinaAuth 实例继续登录流程
   */
  async submitCaptcha(accountId: string, captchaCode: string): Promise<LoginResult> {
    const session = this.sessionManager.getSession(accountId);
    if (!session || !session.auth) {
      return { state: 'failed', message: '会话已过期，请重新登录' };
    }

    const result = await session.auth.loginWithCaptcha(captchaCode, MINA_SID);
    return this.handleAuthResult(accountId, session, result);
  }

  // ===== 短信验证码提交 =====

  /**
   * 提交短信/邮箱验证码
   * 从 session 恢复之前的 MinaAuth 实例继续登录流程
   */
  async submitVerifyCode(accountId: string, code: string): Promise<LoginResult> {
    const session = this.sessionManager.getSession(accountId);
    if (!session || !session.auth) {
      return { state: 'failed', message: '会话已过期，请重新登录' };
    }

    const result = await session.auth.loginWithVerifyCode(code, MINA_SID);
    return this.handleAuthResult(accountId, session, result);
  }

  // ===== 手动Token设置 =====

  /**
   * 手动设置 passToken + userId
   * 使用 passToken 换取 micoapi 的 serviceToken
   */
  async setToken(_accountId: string, passToken: string, userId: string): Promise<LoginResult> {
    // 确保账号存在（使用 userId 作为账号标识）
    await this.ensureAccountExists(userId, userId);
    const effectiveAccountId = userId;

    // 使用 MinaAuth 交换 serviceToken
    const auth = new MinaAuth();
    const result = await auth.refreshByPassToken(passToken, userId, MINA_SID);

    if (result.state !== LoginState.SUCCESS || !result.tokenInfo) {
      return {
        state: 'failed',
        message: `passToken 换取 serviceToken 失败: ${result.error || '未知错误'}`,
      };
    }

    // 创建 MinaHTTPClient 并保存
    await this.setupMinaClient(effectiveAccountId, result.tokenInfo);

    // 保存 passToken 和登录方式
    await this.configManager.updateAccount(effectiveAccountId, {
      pass_token: passToken,
      user_id: userId,
      login_method: 'token',
    });

    // 保存 token 信息
    await this.saveTokenInfo(effectiveAccountId, result.tokenInfo);

    return { state: 'success', message: '令牌设置成功' };
  }

  // ===== 扫码登录 =====

  /**
   * 启动扫码登录
   * 创建 QRCodeLogin 实例并获取二维码
   * @returns 二维码信息或 null
   */
  async startQRCodeLogin(accountId: string): Promise<{ qrcodeUrl: string; loginUrl: string } | null> {
    // 创建 QRCodeLogin 实例
    const qrLogin = new QRCodeLogin();
    this.qrLogins.set(accountId, qrLogin);

    // 获取二维码
    const qrInfo = await qrLogin.getQRCode();
    if (!qrInfo) {
      this.qrLogins.delete(accountId);
      return null;
    }

    return {
      qrcodeUrl: qrInfo.qrcodeUrl,
      loginUrl: qrInfo.loginUrl,
    };
  }

  /**
   * 轮询扫码状态
   * 调用 QRCodeLogin.poll() 检查扫码进度
   * 成功后创建 MinaHTTPClient 并保存凭证
   */
  async pollQRCode(accountId: string): Promise<PollResult> {
    const qrLogin = this.qrLogins.get(accountId);
    if (!qrLogin) {
      return { state: 'failed', message: '没有进行中的扫码登录' };
    }

    const result = await qrLogin.poll();

    // 扫码成功，完成后续流程
    if (result.state === 'confirmed' && result.tokenInfo) {
      this.qrLogins.delete(accountId);

      // 关键步骤：用真实 userId 作为账号 ID（与 Go 版 completeQRCodeLogin 一致）
      const effectiveAccountId = result.tokenInfo.user_id || accountId;

      // 如果 effectiveAccountId 与原始 accountId 不同，需要清理旧的临时账号
      // 否则旧账号会残留在 storage 中，导致 relogin/设备查询用错误的 ID
      if (effectiveAccountId !== accountId) {
        try {
          await this.accountManager.deleteAccount(accountId);
          console.log(`[auth] pollQRCode: cleaned up temporary account: ${accountId}`);
        } catch {
          // 旧账号可能不存在（首次登录），忽略
        }
      }

      await this.ensureAccountExists(effectiveAccountId, effectiveAccountId);
      await this.setupMinaClient(effectiveAccountId, result.tokenInfo);

      // 将实际的 account_id 写入 result，供 handler 返回给前端
      result.account_id = effectiveAccountId;

      // 非关键的持久化和定时器操作，失败不影响登录状态
      try {
        // 保存登录方式和 passToken（passToken 用于后续 serviceToken 续期，
        // 不保存会导致 ~12 小时后 serviceToken 过期时无法刷新，账号掉线）
        const updates: Record<string, any> = {
          user_id: result.tokenInfo.user_id,
          login_method: 'qrcode',
        };
        if (result.passToken) {
          updates.pass_token = result.passToken;
        }
        await this.configManager.updateAccount(effectiveAccountId, updates);

        // 保存 token 信息
        await this.saveTokenInfo(effectiveAccountId, result.tokenInfo);

        // 启动 Token 刷新定时器
        this.startTokenRefresh(effectiveAccountId);
      } catch (e: any) {
        console.log(`[auth] pollQRCode: post-processing error (non-critical): ${e.message || e}`);
      }
    }

    // 终态时清理 QRCodeLogin
    if (result.state === 'expired' || result.state === 'failed') {
      this.qrLogins.delete(accountId);
    }

    return result;
  }

  // ===== 认证状态 =====

  /**
   * 获取账号认证状态（返回与 Go 后端 AuthStatusResponse 一致的格式）
   */
  async getAuthStatus(accountId: string): Promise<{ id: string; logged_in: boolean; is_valid: boolean; user_id: string; login_method: string; account_name: string }> {
    const account = await this.configManager.getAccount(accountId);
    if (!account) {
      return { id: accountId, logged_in: false, is_valid: false, user_id: '', login_method: '', account_name: '' };
    }

    const client = this.accountManager.getMinaClient(accountId);
    if (!client) {
      return { id: accountId, logged_in: false, is_valid: false, user_id: account.user_id || '', login_method: account.login_method || '', account_name: account.account || account.user_id || '' };
    }

    const minaClient = client as MinaHTTPClient;
    const isValid = minaClient.isTokenValid();

    return {
      id: accountId,
      logged_in: true,
      is_valid: isValid,
      user_id: account.user_id || '',
      login_method: account.login_method || '',
      account_name: account.account || account.user_id || '',
    };
  }

  /**
   * 获取所有账号的认证状态
   */
  async getAllAuthStatus(): Promise<Array<{ id: string; logged_in: boolean; is_valid: boolean; user_id: string; login_method: string; account_name: string }>> {
    const accounts = await this.configManager.getAccounts();
    const results = [];
    for (const acc of accounts) {
      results.push(await this.getAuthStatus(acc.id));
    }
    return results;
  }

  // ===== 重新登录 =====

  /**
   * 快速重新登录（QuickReLogin）
   * 优先尝试 passToken → serviceToken → 密码
   * 带60s最小间隔保护（防止雪崩）
   */
  async relogin(accountId: string): Promise<LoginResult> {
    // 60s 最小间隔保护
    const lastTime = this.lastReloginTime.get(accountId);
    if (lastTime && Date.now() - lastTime < RELOGIN_MIN_INTERVAL_MS) {
      console.log(`[auth] relogin skipped: too soon since last attempt, account=${accountId}`);
      return { state: 'success', message: '重登录跳过（距上次不足60s）' };
    }

    console.log(`[auth] relogin starting, account=${accountId}`);
    this.lastReloginTime.set(accountId, Date.now());

    const accountConfig = await this.configManager.getAccount(accountId);
    if (!accountConfig) {
      return { state: 'failed', message: '账号配置不存在' };
    }

    // 优先尝试 passToken 刷新
    if (accountConfig.pass_token) {
      if (await this.refreshServiceTokenByPassToken(accountId, accountConfig.pass_token, accountConfig.user_id)) {
        console.log(`[auth] relogin with passToken succeeded, account=${accountId}`);
        return { state: 'success', message: 'passToken 刷新成功' };
      }
    }

    // 尝试已有的 serviceToken 重新登录
    const micoService = accountConfig.services[MINA_SID];
    if (micoService && micoService.service_token && accountConfig.user_id) {
      if (await this.autoLoginWithToken(accountId, accountConfig.user_id, micoService.service_token, micoService.ssecurity, micoService.expires_at)) {
        console.log(`[auth] relogin with token succeeded, account=${accountId}`);
        this.lastReloginTime.set(accountId, Date.now());
        return { state: 'success', message: 'Token 重登录成功' };
      }
      console.log(`[auth] relogin with token failed, trying password, account=${accountId}`);
    }

    // 尝试密码重新登录
    if (accountConfig.password) {
      const loginResult = await this.autoLoginWithPassword(accountId, accountConfig.account, accountConfig.password);
      if (loginResult) {
        console.log(`[auth] relogin with password succeeded, account=${accountId}`);
        return { state: 'success', message: '密码重登录成功' };
      }
    }

    console.log(`[auth] relogin failed: all methods exhausted, account=${accountId}`);
    return { state: 'failed', message: '重登录失败：所有方式均已尝试' };
  }

  // ===== Token生命周期 =====

  /**
   * 启动 Token 刷新定时器（2小时间隔）
   */
  startTokenRefresh(accountId: string): void {
    // 先清理已有定时器
    this.stopTokenRefresh(accountId);

    const timerId = setInterval(() => {
      this.refreshToken(accountId).catch(e => {
        console.log(`[auth] refreshToken error: account=${accountId} error=${e?.message || e}`);
      });
    }, TOKEN_REFRESH_INTERVAL_MS);

    this.refreshTimers.set(accountId, timerId);
    console.log(`[auth] started token refresh timer for account=${accountId}`);
  }

  /**
   * 停止 Token 刷新定时器
   */
  stopTokenRefresh(accountId: string): void {
    const timerId = this.refreshTimers.get(accountId);
    if (timerId !== undefined) {
      clearInterval(timerId);
      this.refreshTimers.delete(accountId);
      console.log(`[auth] stopped token refresh timer for account=${accountId}`);
    }
  }

  // ===== 初始化 =====

  /**
   * 自动登录所有已保存Token的账号
   * 遍历所有账号配置，根据凭证状态执行不同的恢复策略
   */
  async autoLoginAll(): Promise<void> {
    const accounts = await this.configManager.getAccounts();
    if (accounts.length === 0) {
      console.log('[auth] autoLoginAll: no accounts found');
      return;
    }

    console.log(`[auth] autoLoginAll: processing ${accounts.length} account(s)`);

    for (const account of accounts) {
      try {
        await this.autoLoginAccount(account.id);
      } catch (e: any) {
        console.log(`[auth] autoLoginAll: failed for account=${account.id}: ${e.message || e}`);
      }
    }
  }

  /**
   * 清理所有定时器和资源
   */
  cleanup(): void {
    // 停止所有刷新定时器
    for (const timerId of this.refreshTimers.values()) {
      clearInterval(timerId);
    }
    this.refreshTimers.clear();

    // 停止所有扫码登录
    for (const qrLogin of this.qrLogins.values()) {
      qrLogin.stopPolling();
    }
    this.qrLogins.clear();

    // 清理会话
    this.lastReloginTime.clear();

    console.log('[auth] cleanup: all timers and resources cleared');
  }

  // ===== 私有方法 =====

  /**
   * Token 刷新逻辑
   * 检查 Token 过期时间，接近过期时主动刷新
   * 优先策略：passToken → serviceToken → 密码
   */
  private async refreshToken(accountId: string): Promise<boolean> {
    const accountConfig = await this.configManager.getAccount(accountId);
    if (!accountConfig) {
      console.log(`[auth] refreshToken: account config not found, account=${accountId}`);
      return false;
    }

    // 检查是否需要刷新（剩余时间 < TOKEN_REFRESH_THRESHOLD_HOURS）
    const micoService = accountConfig.services[MINA_SID];
    if (micoService && micoService.expires_at > 0) {
      const remainingMs = micoService.expires_at - Date.now();
      const thresholdMs = TOKEN_REFRESH_THRESHOLD_HOURS * 3600 * 1000;

      if (remainingMs > thresholdMs) {
        // Token 还没接近过期，跳过刷新
        return true;
      }

      if (remainingMs <= 0) {
        console.log(`[auth] refreshToken: token already expired, account=${accountId}`);
      } else {
        const remainingHours = (remainingMs / 3600000).toFixed(1);
        console.log(`[auth] refreshToken: token expiring soon (${remainingHours}h remaining), account=${accountId}`);
      }
    }

    // 优先使用 passToken 刷新
    if (accountConfig.pass_token && accountConfig.user_id) {
      if (await this.refreshServiceTokenByPassToken(accountId, accountConfig.pass_token, accountConfig.user_id)) {
        console.log(`[auth] refreshToken: passToken refresh succeeded, account=${accountId}`);
        return true;
      }
      console.log(`[auth] refreshToken: passToken refresh failed, account=${accountId}`);
    }

    // 尝试已有 serviceToken 刷新
    if (micoService && micoService.service_token && accountConfig.user_id) {
      if (await this.autoLoginWithToken(accountId, accountConfig.user_id, micoService.service_token, micoService.ssecurity, micoService.expires_at)) {
        console.log(`[auth] refreshToken: token login succeeded, account=${accountId}`);
        return true;
      }
    }

    // 尝试密码重登
    if (accountConfig.password && accountConfig.account) {
      if (await this.autoLoginWithPassword(accountId, accountConfig.account, accountConfig.password)) {
        console.log(`[auth] refreshToken: password login succeeded, account=${accountId}`);
        return true;
      }
    }

    console.log(`[auth] refreshToken: all methods failed, account=${accountId}`);
    return false;
  }

  /**
   * Token 失效回调（供 MinaHTTPClient 的 onTokenExpired 使用）
   * 带60s最小间隔保护（防止雪崩）
   * @returns true 如果刷新成功
   */
  private async handleTokenExpired(accountId: string): Promise<boolean> {
    // 60s 最小间隔保护
    const lastTime = this.lastReloginTime.get(accountId);
    if (lastTime && Date.now() - lastTime < RELOGIN_MIN_INTERVAL_MS) {
      console.log(`[auth] handleTokenExpired: skipped (too soon), account=${accountId}`);
      return false;
    }

    console.log(`[auth] handleTokenExpired: refreshing token, account=${accountId}`);
    this.lastReloginTime.set(accountId, Date.now());

    const success = await this.refreshToken(accountId);
    if (success) {
      // 刷新成功，更新当前客户端的 tokenInfo
      const newClient = this.accountManager.getMinaClient(accountId) as MinaHTTPClient | null;
      if (newClient) {
        console.log(`[auth] handleTokenExpired: refresh succeeded, account=${accountId}`);
        return true;
      }
    }

    console.log(`[auth] handleTokenExpired: refresh failed, account=${accountId}`);
    return false;
  }

  /**
   * 使用 passToken 换取新的 serviceToken
   */
  private async refreshServiceTokenByPassToken(accountId: string, passToken: string, userId: string): Promise<boolean> {
    if (!passToken || !userId) return false;

    console.log(`[auth] refreshing serviceToken via passToken, account=${accountId}`);

    const auth = new MinaAuth();
    const result = await auth.refreshByPassToken(passToken, userId, MINA_SID);

    if (result.state !== LoginState.SUCCESS || !result.tokenInfo) {
      console.log(`[auth] passToken refresh failed, account=${accountId}`);
      return false;
    }

    console.log(`[auth] passToken refresh succeeded, account=${accountId}`);

    // 验证新 token 是否有效
    const client = MinaHTTPClient.fromManualToken(
      userId,
      result.tokenInfo.services[MINA_SID]?.service_token || '',
      result.tokenInfo.services[MINA_SID]?.ssecurity || '',
    );

    if (!(await client.validateToken())) {
      console.log(`[auth] refreshed token validation failed, account=${accountId}`);
      return false;
    }

    // 验证通过，保存客户端
    await this.setupMinaClient(accountId, result.tokenInfo);
    await this.saveTokenInfo(accountId, result.tokenInfo);

    return true;
  }

  /**
   * 使用已有 Token 自动登录
   * @returns true 如果登录成功
   */
  private async autoLoginWithToken(
    accountId: string,
    userId: string,
    serviceToken: string,
    ssecurity: string,
    expiresAt: number,
  ): Promise<boolean> {
    if (!serviceToken) return false;

    const client = MinaHTTPClient.fromManualToken(userId, serviceToken, ssecurity);

    // 如果提供了过期时间，更新 tokenInfo
    if (expiresAt > 0) {
      const tokenInfo = client.getTokenInfo();
      tokenInfo.expires_at = new Date(expiresAt).toISOString();
      if (tokenInfo.services[MINA_SID]) {
        tokenInfo.services[MINA_SID].expires_at = expiresAt;
      }
    }

    // 验证 Token 有效性
    if (!(await client.validateToken())) {
      return false;
    }

    // Token 有效，注入失效回调并保存
    const aid = accountId;
    client.setOnTokenExpired(async () => {
      return this.handleTokenExpired(aid);
    });

    this.accountManager.setMinaClient(accountId, client);
    await this.accountManager.setAccountLoggedIn(accountId, client.getTokenInfo());

    return true;
  }

  /**
   * 使用密码自动登录
   * @returns true 如果登录成功
   */
  private async autoLoginWithPassword(accountId: string, username: string, password: string): Promise<boolean> {
    if (!password) return false;

    const auth = new MinaAuth();
    const result = await auth.login(username, password);

    if (result.state !== LoginState.SUCCESS || !result.tokenInfo) {
      // 需要验证码/短信验证的情况下，自动登录无法完成
      if (result.state === LoginState.NEED_CAPTCHA) {
        console.log(`[auth] autoLoginWithPassword: requires captcha, account=${accountId}`);
      } else if (result.state === LoginState.NEED_VERIFY) {
        console.log(`[auth] autoLoginWithPassword: requires verification, account=${accountId}`);
      }
      return false;
    }

    // 登录成功，创建客户端
    await this.setupMinaClient(accountId, result.tokenInfo);
    await this.saveTokenInfo(accountId, result.tokenInfo);

    return true;
  }

  /**
   * 自动登录指定账号
   * 根据配置选择最优的登录策略
   */
  private async autoLoginAccount(accountId: string): Promise<void> {
    const accountConfig = await this.configManager.getAccount(accountId);
    if (!accountConfig) {
      console.log(`[auth] autoLoginAccount: account config not found, account=${accountId}`);
      return;
    }

    // 检查是否需要主动刷新：serviceToken 接近过期且有 passToken
    if (accountConfig.pass_token && accountConfig.services[MINA_SID]) {
      const micoToken = accountConfig.services[MINA_SID];
      if (micoToken.expires_at > 0) {
        const remainingMs = micoToken.expires_at - Date.now();
        const thresholdMs = TOKEN_REFRESH_THRESHOLD_HOURS * 3600 * 1000;

        if (remainingMs < thresholdMs) {
          if (remainingMs <= 0) {
            console.log(`[auth] autoLoginAccount: serviceToken expired, refreshing via passToken, account=${accountId}`);
          } else {
            console.log(`[auth] autoLoginAccount: serviceToken expiring soon, proactively refreshing, account=${accountId}`);
          }

          if (await this.refreshServiceTokenByPassToken(accountId, accountConfig.pass_token, accountConfig.user_id)) {
            console.log(`[auth] autoLoginAccount: passToken refresh succeeded, account=${accountId}`);
            this.startTokenRefresh(accountId);
            return;
          }
          console.log(`[auth] autoLoginAccount: passToken refresh failed, falling back, account=${accountId}`);
        }
      }
    }

    // 尝试 Token 登录
    const micoService = accountConfig.services[MINA_SID];
    if (micoService && micoService.service_token && accountConfig.user_id) {
      if (await this.autoLoginWithToken(accountId, accountConfig.user_id, micoService.service_token, micoService.ssecurity, micoService.expires_at)) {
        console.log(`[auth] autoLoginAccount: token login succeeded, account=${accountId}`);
        this.startTokenRefresh(accountId);
        return;
      }
      console.log(`[auth] autoLoginAccount: token login failed, trying password, account=${accountId}`);
    }

    // 尝试密码登录
    if (accountConfig.password && accountConfig.account) {
      if (await this.autoLoginWithPassword(accountId, accountConfig.account, accountConfig.password)) {
        console.log(`[auth] autoLoginAccount: password login succeeded, account=${accountId}`);
        this.startTokenRefresh(accountId);
        return;
      }
    }

    console.log(`[auth] autoLoginAccount: no valid login method, account=${accountId}`);
  }

  /**
   * 处理 MinaAuth 认证结果（用于 submitCaptcha/submitVerifyCode）
   */
  private async handleAuthResult(
    accountId: string,
    session: LoginSession,
    result: { state: LoginStateType; error?: string; tokenInfo?: XiaomiTokenInfo; captchaImage?: string; verifyUrl?: string; verifyType?: string },
  ): Promise<LoginResult> {
    if (result.state === LoginState.SUCCESS && result.tokenInfo) {
      session.state = 'success';
      this.sessionManager.deleteSession(accountId);

      // 创建 MinaHTTPClient 并保存
      await this.setupMinaClient(accountId, result.tokenInfo);

      // 保存登录方式
      await this.configManager.updateAccount(accountId, { login_method: 'password' });

      // 保存 token 信息
      await this.saveTokenInfo(accountId, result.tokenInfo);

      return { state: 'success', message: '登录成功' };
    }

    if (result.state === LoginState.NEED_CAPTCHA) {
      session.state = 'need_captcha';
      return {
        state: 'need_captcha',
        message: '需要图形验证码',
        captcha_url: result.captchaImage,
      };
    }

    if (result.state === LoginState.NEED_VERIFY) {
      session.state = 'need_verify';
      return {
        state: 'need_verify',
        message: '需要短信/邮箱验证码',
        notification_url: result.verifyUrl,
      };
    }

    session.state = 'failed';
    this.sessionManager.deleteSession(accountId);
    return { state: 'failed', message: result.error || '验证失败' };
  }

  /**
   * 创建 MinaHTTPClient 并注入 Token 失效回调，保存到 AccountManager
   */
  private async setupMinaClient(accountId: string, tokenInfo: XiaomiTokenInfo): Promise<void> {
    const client = new MinaHTTPClient(tokenInfo);

    // 注入 token 失效回调
    const aid = accountId;
    client.setOnTokenExpired(async () => {
      const refreshed = await this.handleTokenExpired(aid);
      if (refreshed) {
        // 刷新成功后，同步新客户端的 tokenInfo 到当前客户端
        const newClient = this.accountManager.getMinaClient(aid) as MinaHTTPClient | null;
        if (newClient && newClient !== client) {
          client.updateTokenInfo(newClient.getTokenInfo());
        }
      }
      return refreshed;
    });

    this.accountManager.setMinaClient(accountId, client);
    await this.accountManager.setAccountLoggedIn(accountId, tokenInfo);
  }

  /**
   * 保存 Token 信息到配置持久化
   */
  private async saveTokenInfo(accountId: string, tokenInfo: XiaomiTokenInfo): Promise<void> {
    const updates: Record<string, any> = {
      user_id: tokenInfo.user_id,
      services: tokenInfo.services,
    };

    try {
      await this.configManager.updateAccount(accountId, updates);
    } catch (e: any) {
      console.log(`[auth] saveTokenInfo: failed, account=${accountId}: ${e.message || e}`);
    }
  }

  /**
   * 确保账号存在，不存在则创建
   */
  private async ensureAccountExists(accountId: string, username: string): Promise<void> {
    const existing = await this.configManager.getAccount(accountId);
    if (!existing) {
      try {
        await this.accountManager.createAccount(accountId, username, 'password');
      } catch {
        // 已存在则忽略
      }
    }
  }
}
