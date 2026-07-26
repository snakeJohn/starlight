import { GBK_PAIR_B64 } from './gbk_table';

let pairMap: Map<number, number> | null = null;

function ensurePairMap(): Map<number, number> {
  if (pairMap) return pairMap;
  const map = new Map<number, number>();
  const binary = base64ToBinary(GBK_PAIR_B64);
  for (let i = 0; i + 3 < binary.length; i += 4) {
    const lead = binary.charCodeAt(i) & 0xff;
    const trail = binary.charCodeAt(i + 1) & 0xff;
    const cp = ((binary.charCodeAt(i + 2) & 0xff) << 8) | (binary.charCodeAt(i + 3) & 0xff);
    map.set((lead << 8) | trail, cp);
  }
  pairMap = map;
  return map;
}

function base64ToBinary(value: string): string {
  if (typeof atob === 'function') {
    return atob(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('binary');
  }
  return '';
}

/**
 * Pure-JS GBK/GB18030-ish dual-byte decoder for Songloft QuickJS,
 * where TextDecoder may only support utf-8.
 */
export function decodeGbkBytes(bytes: Uint8Array): string {
  const map = ensurePairMap();
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] & 0xff;
    // ASCII
    if (b < 0x80) {
      out += String.fromCharCode(b);
      continue;
    }
    // Dual-byte GBK
    if (i + 1 < bytes.length) {
      const trail = bytes[i + 1] & 0xff;
      const cp = map.get((b << 8) | trail);
      if (cp !== undefined) {
        out += String.fromCharCode(cp);
        i += 1;
        continue;
      }
    }
    // Unknown byte — keep replacement so scoring can reject bad paths
    out += '\uFFFD';
  }
  return out;
}
