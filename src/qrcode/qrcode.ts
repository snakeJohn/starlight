// MIoT 智能音箱插件 - 扫码登录模块
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/pkg/qrcode/qrcode.go
// 实现二维码获取、长轮询、状态管理和 Token 交换

import { CookieJar } from '../utils/cookie';
import { fetchWithRedirects } from '../utils/http';
import { MinaAuth } from '../mina/auth';
import { generateDeviceId } from '../utils/crypto';
import { ACCOUNT_BASE_URL, formatUserAgent } from '../mina/constants';
import type { XiaomiTokenInfo } from '../types';

// ===== 常量 =====

/** QR 码登录使用 mijia SID（与 xiaomusic 参考实现一致） */
const QR_LOGIN_SID = 'mijia';

/** 长轮询获取二维码 URL */
const LONG_POLLING_URL = 'https://account.xiaomi.com/longPolling/loginUrl';

/** 轮询间隔（毫秒）- fetch 是阻塞的，poll 本身会等待服务端超时 */
const POLL_INTERVAL_MS = 5000;

/** 最大轮询次数（防止无限轮询） */
const MAX_POLL_COUNT = 20;

// ===== 类型定义 =====

/** 扫码登录状态 */
export type QRCodeState = 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed';

/** 二维码信息 */
export interface QRCodeInfo {
  /** 二维码图片URL（用于前端展示） */
  qrcodeUrl: string;
  /** 用户扫码后跳转的URL（二维码内容） */
  loginUrl: string;
}

/** 轮询结果 */
export interface PollResult {
  state: QRCodeState;
  message: string;
  /** 成功时返回 Token 信息 */
  tokenInfo?: XiaomiTokenInfo;
  /** 成功时返回实际的账号 ID（userId），供前端更新本地引用 */
  account_id?: string;
  /** 扫码登录返回的 passToken，用于后续 serviceToken 续期 */
  passToken?: string;
}

// ===== QRCodeLogin 类 =====

/**
 * QRCodeLogin - 扫码登录管理器
 * 实现完整的二维码登录流程：获取二维码 → 轮询扫码状态 → 交换 serviceToken
 */
export class QRCodeLogin {
  private cookieJar: CookieJar;
  private state: QRCodeState = 'idle';
  private pollUrl: string = '';
  private pollTimer: any = null;
  private sign: string = '';
  private qs: string = '';
  private callback: string = '';
  private sid: string = 'micoapi';  // 目标服务 SID（最终需要的 serviceToken 对应的服务）
  private deviceId: string;
  private userAgent: string;
  private pollCount: number = 0;
  private onStateChange?: (state: QRCodeState, result?: PollResult) => void;

  constructor(onStateChange?: (state: QRCodeState, result?: PollResult) => void) {
    this.cookieJar = new CookieJar();
    this.deviceId = generateDeviceId();
    this.userAgent = formatUserAgent(this.deviceId);
    this.onStateChange = onStateChange;
  }

  /**
   * 获取二维码（第一步）
   * 1. 调用 serviceLogin 获取 _sign, qs, callback
   * 2. 请求 longPolling/loginUrl 获取二维码 URL 和轮询 URL
   */
  async getQRCode(): Promise<QRCodeInfo | null> {
    try {
      // Step 1: GET serviceLogin 获取登录签名参数
      const serviceLoginUrl = `${ACCOUNT_BASE_URL}/pass/serviceLogin?sid=${QR_LOGIN_SID}&_json=true`;

      const headers: Record<string, string> = {
        'User-Agent': this.userAgent,
        'Cookie': `sdkVersion=3.8.6; deviceId=${this.deviceId}`,
      };

      const { response: resp1 } = await fetchWithRedirects(serviceLoginUrl, {
        method: 'GET',
        headers,
      }, this.cookieJar, 0);

      const body1 = resp1.text();
      const jsonStr1 = stripJsonPrefix(body1);

      let loginData: Record<string, unknown>;
      try {
        loginData = JSON.parse(jsonStr1);
      } catch {
        console.log('[qrcode] getQRCode: failed to parse serviceLogin response');
        return null;
      }

      this.sign = getStringValue(loginData, '_sign', '');
      this.qs = getStringValue(loginData, 'qs', '');
      this.callback = getStringValue(loginData, 'callback', '');

      if (!this.sign || !this.qs || !this.callback) {
        console.log('[qrcode] getQRCode: missing required login parameters');
        return null;
      }

      // Step 2: GET longPolling/loginUrl 获取二维码 URL 和轮询 URL
      const params = [
        `_qrsize=240`,
        `qs=${encodeURIComponent(this.qs)}`,
        `sid=${QR_LOGIN_SID}`,
        `_sign=${encodeURIComponent(this.sign)}`,
        `callback=${encodeURIComponent(this.callback)}`,
        `_json=true`,
        `_dc=${Date.now()}`,
      ].join('&');

      const qrUrl = `${LONG_POLLING_URL}?${params}`;

      const headers2: Record<string, string> = {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      const cookieHeader = this.cookieJar.getCookieHeader(qrUrl);
      if (cookieHeader) {
        headers2['Cookie'] = cookieHeader;
      }

      const { response: resp2 } = await fetchWithRedirects(qrUrl, {
        method: 'GET',
        headers: headers2,
      }, this.cookieJar, 0);

      const body2 = resp2.text();
      const jsonStr2 = stripJsonPrefix(body2);

      let qrData: Record<string, unknown>;
      try {
        qrData = JSON.parse(jsonStr2);
      } catch {
        console.log('[qrcode] getQRCode: failed to parse QR code response');
        return null;
      }

      // 检查返回码
      const code = Number(qrData['code'] || 0);
      if (code !== 0) {
        const desc = getStringValue(qrData, 'desc', 'unknown error');
        console.log(`[qrcode] getQRCode: QR code request failed: code=${code}, desc=${desc}`);
        return null;
      }

      // 提取二维码 URL 和轮询 URL
      const qrCodeImageUrl = getStringValue(qrData, 'qr', '');
      const loginUrl = getStringValue(qrData, 'loginUrl', '');
      const lpUrl = getStringValue(qrData, 'lp', '');

      if (!lpUrl) {
        console.log('[qrcode] getQRCode: missing lp (long polling) URL');
        return null;
      }

      // 保存轮询 URL，更新状态
      this.pollUrl = lpUrl;
      this.pollCount = 0;
      this.updateState('waiting');

      return {
        qrcodeUrl: qrCodeImageUrl || loginUrl,
        loginUrl: loginUrl,
      };
    } catch (e: any) {
      console.log(`[qrcode] getQRCode: error: ${e.message || e}`);
      this.updateState('failed');
      return null;
    }
  }

  /**
   * 单次轮询（检查扫码状态）
   * 对 lpUrl 发起 GET 请求（服务端长轮询，约 30s 超时）
   * 返回当前状态和可能的 Token 信息
   */
  async poll(): Promise<PollResult> {
    if (!this.pollUrl) {
      return { state: 'failed', message: 'no poll URL, call getQRCode() first' };
    }

    this.pollCount++;

    // 超过最大轮询次数，认为二维码已过期
    if (this.pollCount > MAX_POLL_COUNT) {
      this.updateState('expired');
      return { state: 'expired', message: 'QR code expired (max poll count reached)' };
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      const cookieHeader = this.cookieJar.getCookieHeader(this.pollUrl);
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      let response: any;
      try {
        const result = await fetchWithRedirects(this.pollUrl, {
          method: 'GET',
          headers,
        }, this.cookieJar, 0);
        response = result.response;
      } catch (e: any) {
        // 超时处理：fetch 阻塞超时后抛出异常
        const errMsg = String(e.message || e).toLowerCase();
        if (errMsg.includes('timeout') || errMsg.includes('deadline') ||
            errMsg.includes('canceled') || errMsg.includes('aborted')) {
          // 超时 = 还在等待用户扫码
          return { state: 'waiting', message: 'waiting for QR code scan (timeout)' };
        }
        throw e;
      }

      // 检查 HTTP 状态码
      const status = response.status;
      if (status === 403) {
        this.updateState('expired');
        return { state: 'expired', message: 'QR code expired (403 Forbidden)' };
      }
      if (status >= 400) {
        this.updateState('failed');
        return { state: 'failed', message: `poll failed: HTTP ${status}` };
      }

      const bodyText = response.text();
      const jsonStr = stripJsonPrefix(bodyText);

      let pollData: Record<string, unknown>;
      try {
        pollData = JSON.parse(jsonStr);
      } catch {
        // 解析失败可能是超时空响应
        return { state: 'waiting', message: 'waiting for QR code scan (empty response)' };
      }

      // 检查返回码
      const code = Number(pollData['code'] || 0);
      if (code !== 0) {
        const desc = getStringValue(pollData, 'desc', 'unknown error');
        // code != 0 通常表示二维码过期或失败
        this.updateState('expired');
        return { state: 'expired', message: `QR code login failed: code=${code}, desc=${desc}` };
      }

      // 检查是否有 passToken 和 userId（扫码成功并确认）
      const passToken = getStringValue(pollData, 'passToken', '');
      const userId = getStringValue(pollData, 'userId', '');
      const cUserId = getStringValue(pollData, 'cUserId', '');

      if (!passToken || !userId) {
        // 没有 passToken，可能是中间状态（已扫码但未确认）
        // 小米 LP 接口在扫码但未确认时不会返回 passToken
        // 实际上如果收到正常 JSON 响应但没有 passToken，通常是超时重连
        return { state: 'waiting', message: 'waiting for QR code confirmation' };
      }

      // 扫码成功，进入确认状态
      console.log(`[qrcode] poll: QR code login successful, userId=${userId}`);

      // 使用 MinaAuth 交换目标服务的 serviceToken
      const tokenInfo = await this.exchangeToken(passToken, userId, cUserId);
      if (!tokenInfo) {
        this.updateState('failed');
        return { state: 'failed', message: 'failed to exchange serviceToken' };
      }

      this.updateState('confirmed');
      const result: PollResult = {
        state: 'confirmed',
        message: 'QR code login successful',
        tokenInfo,
        passToken,
      };
      return result;
    } catch (e: any) {
      console.log(`[qrcode] poll: error: ${e.message || e}`);
      this.updateState('failed');
      return { state: 'failed', message: `poll error: ${e.message || e}` };
    }
  }

  /**
   * 启动自动轮询
   * 使用 setInterval 驱动轮询循环
   * 每次 poll() 本身会阻塞到服务端超时（约 30s），所以间隔设短即可
   */
  async startPolling(): Promise<void> {
    if (this.pollTimer !== null) {
      return; // 已在轮询中
    }

    if (!this.pollUrl) {
      console.log('[qrcode] startPolling: no poll URL, call getQRCode() first');
      return;
    }

    // 立即执行一次轮询
    const firstResult = await this.poll();
    if (this.isTerminalState(firstResult.state)) {
      if (this.onStateChange) {
        this.onStateChange(firstResult.state, firstResult);
      }
      return;
    }

    // 设置定时器继续轮询
    this.pollTimer = setInterval(async () => {
      const result = await this.poll();

      if (this.onStateChange) {
        this.onStateChange(result.state, result);
      }

      // 如果达到终态，停止轮询
      if (this.isTerminalState(result.state)) {
        this.stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * 停止轮询
   */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): QRCodeState {
    return this.state;
  }

  /**
   * 获取设备ID（外部可能需要用于其他请求）
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * 获取 CookieJar（外部可能需要用于后续请求）
   */
  getCookieJar(): CookieJar {
    return this.cookieJar;
  }

  /**
   * 重置（准备新的扫码登录）
   */
  reset(): void {
    this.stopPolling();
    this.state = 'idle';
    this.pollUrl = '';
    this.sign = '';
    this.qs = '';
    this.callback = '';
    this.pollCount = 0;
    this.cookieJar.clear();
  }

  // ===== 私有方法 =====

  /**
   * 使用 passToken 交换目标服务的 serviceToken
   * 通过 MinaAuth 的 refreshByPassToken 方法实现
   */
  private async exchangeToken(passToken: string, userId: string, cUserId: string): Promise<XiaomiTokenInfo | null> {
    try {
      console.log(`[qrcode] exchangeToken: exchanging passToken for ${this.sid} serviceToken`);

      // 创建 MinaAuth 实例来完成 token 交换
      const auth = new MinaAuth();

      // 将 QR 登录获取的 cookies 注入到 MinaAuth 的 CookieJar 中
      // 特别是 cUserId 可能需要
      const authCookieJar = auth.getCookieJar();
      if (cUserId) {
        authCookieJar.addFromHeaders(
          [`cUserId=${cUserId}; domain=xiaomi.com; path=/`],
          ACCOUNT_BASE_URL,
        );
      }

      // 使用 refreshByPassToken 交换 serviceToken
      const result = await auth.refreshByPassToken(passToken, userId, this.sid);

      if (result.state !== 'success' || !result.tokenInfo) {
        console.log(`[qrcode] exchangeToken: failed: ${result.error || 'unknown error'}`);
        return null;
      }

      console.log(`[qrcode] exchangeToken: successfully obtained ${this.sid} serviceToken`);
      return result.tokenInfo;
    } catch (e: any) {
      console.log(`[qrcode] exchangeToken: error: ${e.message || e}`);
      return null;
    }
  }

  /**
   * 更新状态并触发回调
   */
  private updateState(newState: QRCodeState, result?: PollResult): void {
    this.state = newState;
    if (this.onStateChange && result) {
      this.onStateChange(newState, result);
    }
  }

  /**
   * 判断是否为终态
   */
  private isTerminalState(state: QRCodeState): boolean {
    return state === 'confirmed' || state === 'expired' || state === 'failed';
  }
}

// ===== 工具函数 =====

/**
 * 去掉小米 API 响应的 JSON 前缀 "&&&START&&&"
 */
function stripJsonPrefix(body: string): string {
  return body.replace('&&&START&&&', '').trim();
}

/**
 * 从 map 中获取字符串值（兼容数字类型的 userId 等）
 */
function getStringValue(obj: Record<string, unknown>, key: string, defaultValue: string): string {
  const v = obj[key];
  if (v === undefined || v === null) return defaultValue;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(Math.floor(v));
  return String(v);
}
