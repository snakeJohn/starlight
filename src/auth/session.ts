// MIoT 智能音箱插件 - 登录会话管理
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/auth/session.go
// 保存登录过程中的中间状态，用于多步骤登录流程中保持上下文

import { MinaAuth } from '../mina/auth';

// ===== 类型定义 =====

/** 会话状态 */
export type SessionState =
  | 'idle'
  | 'step1'
  | 'step2'
  | 'need_captcha'
  | 'need_verify'
  | 'step3'
  | 'success'
  | 'failed';

// ===== LoginSession =====

/**
 * LoginSession - 登录会话
 * 保存登录过程中的中间状态
 * 用于在多步骤登录流程中保持上下文（验证码需要之前的_sign/qs等）
 * 每个账号同时只能有一个活跃的 LoginSession
 */
export class LoginSession {
  state: SessionState = 'idle';
  accountId: string;
  username: string = '';
  password: string = '';  // MD5后的

  // MinaAuth 实例（保持登录流程上下文，包括 CookieJar）
  auth: MinaAuth | null = null;

  // Step1数据
  sign: string = '';
  qs: string = '';
  callback: string = '';
  sid: string = 'micoapi';

  // 验证码数据
  captchaUrl: string = '';
  ick: string = '';

  // 短信验证数据
  notificationUrl: string = '';

  // Step2结果
  location: string = '';

  // 错误信息
  errorMessage: string = '';

  // 创建时间
  createdAt: number = Date.now();

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  /** 重置会话到初始状态 */
  reset(): void {
    this.state = 'idle';
    this.username = '';
    this.password = '';
    this.auth = null;
    this.sign = '';
    this.qs = '';
    this.callback = '';
    this.sid = 'micoapi';
    this.captchaUrl = '';
    this.ick = '';
    this.notificationUrl = '';
    this.location = '';
    this.errorMessage = '';
    this.createdAt = Date.now();
  }

  /** 检查会话是否过期（1小时） */
  isExpired(): boolean {
    return Date.now() - this.createdAt > 3600 * 1000;
  }
}

// ===== SessionManager =====

/**
 * SessionManager - 会话管理器
 * 管理密码登录会话和二维码登录会话
 */
export class SessionManager {
  private sessions: Map<string, LoginSession>;  // accountId → LoginSession

  constructor() {
    this.sessions = new Map();
  }

  /** 创建或获取会话 */
  getOrCreateSession(accountId: string): LoginSession {
    let session = this.sessions.get(accountId);
    if (!session || session.isExpired()) {
      session = new LoginSession(accountId);
      this.sessions.set(accountId, session);
    }
    return session;
  }

  /** 获取会话 */
  getSession(accountId: string): LoginSession | null {
    const session = this.sessions.get(accountId);
    if (!session) return null;
    if (session.isExpired()) {
      this.sessions.delete(accountId);
      return null;
    }
    return session;
  }

  /** 删除会话 */
  deleteSession(accountId: string): void {
    this.sessions.delete(accountId);
  }

  /** 清理所有过期会话 */
  cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [accountId, session] of this.sessions) {
      if (now - session.createdAt > 3600 * 1000) {
        this.sessions.delete(accountId);
      }
    }
  }
}
