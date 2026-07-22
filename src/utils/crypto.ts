// 加密工具：优先 Songloft QuickJS polyfill；无 polyfill 时用纯 JS（vitest / 无 crypto 环境）
// 禁止 require('crypto') / node:crypto —— plugin-builder 会拒绝 Node builtin。

/// <reference types="@songloft/plugin-sdk" />

type PolyfillCrypto = {
  md5?(str: string): string;
  aesEncrypt?(data: any, mode: string, key: any, iv?: any): { _hex: string; toString(fmt?: string): string };
  rsaEncrypt?(data: any, key: string): { _hex: string; toString(fmt?: string): string };
  randomBytes?(size: number): { _hex: string; toString(fmt?: string): string; length: number };
};

function polyfill(): PolyfillCrypto {
  return (globalThis as unknown as { crypto?: PolyfillCrypto }).crypto || {};
}

// ---------- pure JS MD5 (RFC 1321, portable 32-bit arithmetic) ----------

function md5Pure(input: string): string {
  function rotateLeft(lValue: number, iShiftBits: number): number {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number): number {
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    }
    return lResult ^ lX8 ^ lY8;
  }
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;
  const I = (x: number, y: number, z: number) => y ^ (x | ~z);
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function wordToHex(lValue: number): string {
    let out = '';
    for (let count = 0; count <= 3; count++) {
      const lByte = (lValue >>> (count * 8)) & 255;
      out += lByte.toString(16).padStart(2, '0');
    }
    return out;
  }

  // UTF-8 encode (same as unescape(encodeURIComponent(...)))
  let str = '';
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) str += String.fromCharCode(c);
    else if (c < 0x800) str += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = input.charCodeAt(++i);
      const u = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      str += String.fromCharCode(
        0xf0 | (u >> 18),
        0x80 | ((u >> 12) & 0x3f),
        0x80 | ((u >> 6) & 0x3f),
        0x80 | (u & 0x3f),
      );
    } else {
      str += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }

  const lMessageLength = str.length;
  const lNumberOfWords = (((lMessageLength + 8 - ((lMessageLength + 8) % 64)) / 64) + 1) * 16;
  const x = new Array<number>(lNumberOfWords).fill(0);
  for (let lByteCount = 0; lByteCount < lMessageLength; lByteCount++) {
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    const lBytePosition = (lByteCount % 4) * 8;
    x[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
  }
  {
    const lByteCount = lMessageLength;
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    const lBytePosition = (lByteCount % 4) * 8;
    x[lWordCount] |= 0x80 << lBytePosition;
  }
  x[lNumberOfWords - 2] = lMessageLength << 3;
  x[lNumberOfWords - 1] = lMessageLength >>> 29;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a;
    const BB = b;
    const CC = c;
    const DD = d;
    a = FF(a, b, c, d, x[k + 0], 7, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], 17, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], 12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], 17, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], 7, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], 7, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], 12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], 17, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], 22, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], 5, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], 9, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], 14, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], 5, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], 9, 0x02441453);
    c = GG(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], 9, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], 14, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], 4, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], 11, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], 4, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], 23, 0xc4ac5665);
    a = II(a, b, c, d, x[k + 0], 6, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], 10, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], 15, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], 6, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], 15, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], 15, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], 6, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], 10, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], 21, 0xeb86d391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

/**
 * Cryptographically secure random bytes for secrets (LX password, serverId, device ids).
 * Prefer Web Crypto getRandomValues; never fall back to Math.random for security-sensitive use.
 */
function randomBytesPure(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const g = globalThis as {
    crypto?: {
      getRandomValues?: (a: Uint8Array) => Uint8Array;
    };
  };
  if (typeof g.crypto?.getRandomValues === 'function') {
    g.crypto.getRandomValues(out);
    return out;
  }
  throw new Error(
    'CSPRNG unavailable: crypto.getRandomValues is required for secret generation',
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(Array.from(bytes)).toString('base64');
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/**
 * MD5哈希（小写 hex）
 */
export function md5(str: string): string {
  const c = polyfill();
  if (typeof c.md5 === 'function') return c.md5(str);
  return md5Pure(str);
}

/**
 * 生成随机设备ID：16 字节 hex（32 字符）
 */
export function generateDeviceId(): string {
  return randomHex(16);
}

/**
 * 生成随机字节的 hex 字符串
 */
export function randomHex(size: number): string {
  const c = polyfill();
  if (typeof c.randomBytes === 'function') {
    return c.randomBytes(size).toString('hex');
  }
  return bytesToHex(randomBytesPure(size));
}

/**
 * 生成随机 Base64 字符串
 */
export function randomBase64(size: number): string {
  const c = polyfill();
  if (typeof c.randomBytes === 'function') {
    return c.randomBytes(size).toString('base64');
  }
  return bytesToBase64(randomBytesPure(size));
}

/**
 * AES-CBC 加密 → Base64（依赖 host polyfill；生产环境由 Songloft 提供）
 */
export function aesEncryptCBC(data: string, key: string, iv: string): string {
  const c = polyfill();
  if (typeof c.aesEncrypt === 'function') {
    return c.aesEncrypt(data, 'cbc', key, iv).toString('base64');
  }
  throw new Error('aesEncryptCBC unavailable (Songloft crypto polyfill required)');
}

/**
 * 生成简单唯一 ID
 */
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString();
  const random = randomHex(4);
  if (prefix) return `${prefix}_${timestamp}_${random}`;
  return `${timestamp}_${random}`;
}
