/**
 * Crypto helpers for LX Music sync protocol.
 * AES-128-ECB (PKCS7), RSA-OAEP-SHA1, gzip envelope (cg_ prefix).
 * Works in Node (vitest) and Songloft QuickJS (no node:crypto import).
 */

import pako from 'pako';
import { md5 as md5Hex, randomHex } from '../utils/crypto';

// ---------- bytes / encoding ----------

function utf8ToBytes(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const u = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const u =
        ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const t = u - 0x10000;
      out += String.fromCharCode(0xd800 + (t >> 10), 0xdc00 + (t & 0x3ff));
    }
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
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

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  const inv: Record<string, number> = {};
  for (let i = 0; i < B64.length; i++) inv[B64[i]] = i;
  for (let i = 0; i < len; i += 4) {
    const n =
      (inv[clean[i]] << 18) |
      (inv[clean[i + 1]] << 12) |
      ((clean[i + 2] === '=' ? 0 : inv[clean[i + 2]]) << 6) |
      (clean[i + 3] === '=' ? 0 : inv[clean[i + 3]]);
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? `0${hex}` : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// ---------- MD5 / password key ----------

export function toMD5(str: string): string {
  return md5Hex(str);
}

/** LX auth code key: base64(utf8(md5(code).slice(0,16))) */
export function authCodeToAesKey(authCode: string): string {
  const slice = toMD5(authCode).substring(0, 16);
  return bytesToBase64(utf8ToBytes(slice));
}

// ---------- AES-128-ECB PKCS7 (compact S-box implementation) ----------

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9,
  0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f,
  0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07,
  0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3,
  0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58,
  0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3,
  0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f,
  0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88,
  0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac,
  0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a,
  0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70,
  0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
  0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
  0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const RSBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) RSBOX[SBOX[i]] = i;

const RCON = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function xtime(a: number): number {
  return ((a << 1) ^ (((a >> 7) & 1) * 0x1b)) & 0xff;
}

function expandKey(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16));
  let bytesGenerated = 16;
  let rconIter = 1;
  const temp = new Uint8Array(4);
  while (bytesGenerated < 176) {
    for (let i = 0; i < 4; i++) temp[i] = w[bytesGenerated - 4 + i];
    if (bytesGenerated % 16 === 0) {
      const t = temp[0];
      temp[0] = temp[1];
      temp[1] = temp[2];
      temp[2] = temp[3];
      temp[3] = t;
      for (let i = 0; i < 4; i++) temp[i] = SBOX[temp[i]];
      temp[0] ^= RCON[rconIter++];
    }
    for (let i = 0; i < 4; i++) {
      w[bytesGenerated] = w[bytesGenerated - 16] ^ temp[i];
      bytesGenerated++;
    }
  }
  return w;
}

function addRoundKey(state: Uint8Array, roundKey: Uint8Array, round: number): void {
  for (let i = 0; i < 16; i++) state[i] ^= roundKey[round * 16 + i];
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = RSBOX[state[i]];
}

function shiftRows(state: Uint8Array): void {
  let t = state[1];
  state[1] = state[5];
  state[5] = state[9];
  state[9] = state[13];
  state[13] = t;
  t = state[2];
  state[2] = state[10];
  state[10] = t;
  t = state[6];
  state[6] = state[14];
  state[14] = t;
  t = state[15];
  state[15] = state[11];
  state[11] = state[7];
  state[7] = state[3];
  state[3] = t;
}

function invShiftRows(state: Uint8Array): void {
  let t = state[13];
  state[13] = state[9];
  state[9] = state[5];
  state[5] = state[1];
  state[1] = t;
  t = state[2];
  state[2] = state[10];
  state[10] = t;
  t = state[6];
  state[6] = state[14];
  state[14] = t;
  t = state[3];
  state[3] = state[7];
  state[7] = state[11];
  state[11] = state[15];
  state[15] = t;
}

function mixColumns(state: Uint8Array): void {
  for (let i = 0; i < 4; i++) {
    const a = state[i * 4];
    const b = state[i * 4 + 1];
    const c = state[i * 4 + 2];
    const d = state[i * 4 + 3];
    const e = a ^ b ^ c ^ d;
    state[i * 4] ^= e ^ xtime(a ^ b);
    state[i * 4 + 1] ^= e ^ xtime(b ^ c);
    state[i * 4 + 2] ^= e ^ xtime(c ^ d);
    state[i * 4 + 3] ^= e ^ xtime(d ^ a);
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let i = 0; i < 4; i++) {
    const a = state[i * 4];
    const b = state[i * 4 + 1];
    const c = state[i * 4 + 2];
    const d = state[i * 4 + 3];
    const u = xtime(xtime(a ^ c));
    const v = xtime(xtime(b ^ d));
    state[i * 4] ^= u;
    state[i * 4 + 1] ^= v;
    state[i * 4 + 2] ^= u;
    state[i * 4 + 3] ^= v;
  }
  mixColumns(state);
}

function encryptBlock(input: Uint8Array, roundKey: Uint8Array): Uint8Array {
  const state = new Uint8Array(input);
  addRoundKey(state, roundKey, 0);
  for (let round = 1; round < 10; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, roundKey, round);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, roundKey, 10);
  return state;
}

function decryptBlock(input: Uint8Array, roundKey: Uint8Array): Uint8Array {
  const state = new Uint8Array(input);
  addRoundKey(state, roundKey, 10);
  for (let round = 9; round > 0; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, roundKey, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, roundKey, 0);
  return state;
}

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (!data.length) throw new Error('empty decrypt');
  const pad = data[data.length - 1];
  if (pad < 1 || pad > 16) throw new Error('bad padding');
  return data.subarray(0, data.length - pad);
}

export function aesEncrypt(text: string, keyBase64: string): string {
  const key = base64ToBytes(keyBase64);
  if (key.length !== 16) throw new Error('AES key must be 16 bytes');
  const roundKey = expandKey(key);
  const padded = pkcs7Pad(utf8ToBytes(text));
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    out.set(encryptBlock(padded.subarray(i, i + 16), roundKey), i);
  }
  return bytesToBase64(out);
}

export function aesDecrypt(cipherBase64: string, keyBase64: string): string {
  const key = base64ToBytes(keyBase64);
  if (key.length !== 16) throw new Error('AES key must be 16 bytes');
  const roundKey = expandKey(key);
  const data = base64ToBytes(cipherBase64);
  if (data.length % 16 !== 0) throw new Error('bad cipher length');
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) {
    out.set(decryptBlock(data.subarray(i, i + 16), roundKey), i);
  }
  return bytesToUtf8(pkcs7Unpad(out));
}

// ---------- RSA-OAEP-SHA1 (public encrypt only) ----------

function sha1Pure(message: Uint8Array): Uint8Array {
  const ml = message.length;
  const withOne = new Uint8Array(((ml + 9 + 63) & ~63));
  withOne.set(message);
  withOne[ml] = 0x80;
  const bitLen = ml * 8;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 4, bitLen >>> 0, false);
  view.setUint32(withOne.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = ((x << 1) | (x >>> 31)) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0, false);
  ov.setUint32(4, h1, false);
  ov.setUint32(8, h2, false);
  ov.setUint32(12, h3, false);
  ov.setUint32(16, h4, false);
  return out;
}

function mgf1(seed: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const c = new Uint8Array(4);
    c[0] = (counter >>> 24) & 0xff;
    c[1] = (counter >>> 16) & 0xff;
    c[2] = (counter >>> 8) & 0xff;
    c[3] = counter & 0xff;
    const block = sha1Pure(concatBytes(seed, c));
    out.set(block.subarray(0, Math.min(20, length - offset)), offset);
    offset += 20;
    counter++;
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function parseSpkiPublicKey(pemOrBody: string): { n: bigint; e: bigint } {
  let body = pemOrBody.trim();
  if (body.includes('BEGIN')) {
    body = body
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
  } else {
    body = body.replace(/\s+/g, '');
  }
  const der = base64ToBytes(body);
  // Minimal DER walk to BIT STRING containing PKCS#1 RSAPublicKey
  let i = 0;
  const expect = (tag: number) => {
    if (der[i++] !== tag) throw new Error('bad SPKI');
  };
  const readLen = (): number => {
    let len = der[i++];
    if (len < 0x80) return len;
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | der[i++];
    return len;
  };
  expect(0x30);
  readLen();
  expect(0x30);
  const algLen = readLen();
  i += algLen;
  expect(0x03);
  const bitLen = readLen();
  i += 1; // unused bits
  const pkcs1 = der.subarray(i, i + bitLen - 1);
  i = 0;
  const d = pkcs1;
  if (d[i++] !== 0x30) throw new Error('bad RSAPublicKey');
  const seqLen = (() => {
    let len = d[i++];
    if (len < 0x80) return len;
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | d[i++];
    return len;
  })();
  void seqLen;
  const readInt = (): bigint => {
    if (d[i++] !== 0x02) throw new Error('bad int');
    let len = d[i++];
    if (len >= 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | d[i++];
    }
    let start = i;
    // skip leading zero
    if (d[start] === 0x00) {
      start++;
      len--;
    }
    let v = 0n;
    for (let k = 0; k < len; k++) v = (v << 8n) | BigInt(d[start + k]);
    i = start + len;
    return v;
  };
  const n = readInt();
  const e = readInt();
  return { n, e };
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function randomBytes(size: number): Uint8Array {
  const hex = randomHex(size);
  return hexToBytes(hex.length >= size * 2 ? hex.slice(0, size * 2) : hex.padStart(size * 2, '0'));
}

export function rsaEncryptOaepSha1(plain: Uint8Array, publicKeyPemOrBody: string): string {
  const { n, e } = parseSpkiPublicKey(publicKeyPemOrBody);
  const k = Math.ceil(n.toString(16).length / 2);
  const hLen = 20;
  if (plain.length > k - 2 * hLen - 2) throw new Error('message too long for RSA-OAEP');

  const labelHash = sha1Pure(new Uint8Array(0));
  const ps = new Uint8Array(k - plain.length - 2 * hLen - 2);
  const db = concatBytes(labelHash, ps, new Uint8Array([0x01]), plain);
  const seed = randomBytes(hLen);
  const dbMask = mgf1(seed, k - hLen - 1);
  const maskedDb = new Uint8Array(db.length);
  for (let i = 0; i < db.length; i++) maskedDb[i] = db[i] ^ dbMask[i];
  const seedMask = mgf1(maskedDb, hLen);
  const maskedSeed = new Uint8Array(hLen);
  for (let i = 0; i < hLen; i++) maskedSeed[i] = seed[i] ^ seedMask[i];
  const em = concatBytes(new Uint8Array([0x00]), maskedSeed, maskedDb);

  let m = 0n;
  for (let i = 0; i < em.length; i++) m = (m << 8n) | BigInt(em[i]);
  const c = modPow(m, e, n);
  let hex = c.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  while (hex.length < k * 2) hex = `00${hex}`;
  return bytesToBase64(hexToBytes(hex));
}

export function rsaEncryptJson(payload: object, publicKeyBody: string): string {
  return rsaEncryptOaepSha1(utf8ToBytes(JSON.stringify(payload)), publicKeyBody);
}

// ---------- message envelope (gzip optional) ----------

export async function encodeData(data: string): Promise<string> {
  if (data.length <= 1024) return data;
  const gzipFn = typeof pako.gzip === 'function' ? pako.gzip : null;
  if (!gzipFn) {
    // Fallback: send uncompressed if gzip unavailable (messages may still work under 1MB).
    return data;
  }
  const compressed = gzipFn(utf8ToBytes(data));
  return `cg_${bytesToBase64(compressed)}`;
}

export async function decodeData(enData: string): Promise<string> {
  if (!enData.startsWith('cg_')) return enData;
  const raw = base64ToBytes(enData.slice(3));
  const ungzipFn = typeof pako.ungzip === 'function' ? pako.ungzip : null;
  if (!ungzipFn) throw new Error('gzip decode unavailable');
  const inflated = ungzipFn(raw) as Uint8Array;
  return bytesToUtf8(new Uint8Array(inflated));
}

export function createClientSessionKey(): { clientId: string; key: string } {
  // 16 random bytes → base64 (matches lxserver randomBytes(16).toString('base64'))
  const key = bytesToBase64(randomBytes(16));
  // clientId: 16 random bytes base64 (lxserver randomBytes(4*4))
  const clientId = bytesToBase64(randomBytes(16));
  return { clientId, key };
}

export function createServerId(): string {
  return bytesToBase64(randomBytes(16));
}

export function generatePassword(): string {
  // 6-digit style like lx generateCode
  const n = parseInt(randomHex(3), 16) % 1000000;
  return String(n).padStart(6, '0');
}

export { utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes };
