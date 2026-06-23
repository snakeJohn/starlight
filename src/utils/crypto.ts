// MIoT 智能音箱插件 - 加密工具
// 基于 QuickJS 全局 crypto 对象（由 polyfill 提供）

/// <reference types="@songloft/plugin-sdk" />

// QuickJS polyfill 中 crypto 全局对象的类型声明
declare const crypto: {
  md5(str: string): string;
  aesEncrypt(data: any, mode: string, key: any, iv?: any): { _hex: string; toString(fmt?: string): string };
  rsaEncrypt(data: any, key: string): { _hex: string; toString(fmt?: string): string };
  randomBytes(size: number): { _hex: string; toString(fmt?: string): string; length: number };
};

/**
 * MD5哈希
 * 用于小米登录的密码加密
 * @param str - 输入字符串
 * @returns 小写hex格式的MD5哈希
 */
export function md5(str: string): string {
  return crypto.md5(str);
}

/**
 * 生成随机设备ID
 * 格式：16字节随机hex字符串（32位）
 * 用于模拟小米设备标识
 * @returns 32字符的hex字符串
 */
export function generateDeviceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 生成随机字节的hex字符串
 * @param size - 字节数
 * @returns hex格式字符串
 */
export function randomHex(size: number): string {
  return crypto.randomBytes(size).toString('hex');
}

/**
 * 生成随机Base64字符串
 * @param size - 字节数
 * @returns base64格式字符串
 */
export function randomBase64(size: number): string {
  return crypto.randomBytes(size).toString('base64');
}

/**
 * AES-CBC加密
 * @param data - 明文字符串
 * @param key - 密钥字符串
 * @param iv - 初始向量字符串
 * @returns Base64编码的密文
 */
export function aesEncryptCBC(data: string, key: string, iv: string): string {
  return crypto.aesEncrypt(data, 'cbc', key, iv).toString('base64');
}

/**
 * 生成简单的唯一ID
 * 用于任务ID等场景
 * @param prefix - 前缀（默认空）
 * @returns 格式如 "prefix_1234567890123" 或 "1234567890123_randomhex"
 */
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(4).toString('hex');
  if (prefix) {
    return `${prefix}_${timestamp}_${random}`;
  }
  return `${timestamp}_${random}`;
}
