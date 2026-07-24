import { describe, expect, it } from 'vitest';
import pako from 'pako';
import {
  decodeData,
  encodeData,
  LX_WS_MAX_INFLATED_BYTES,
  bytesToBase64,
} from '../../src/lx_sync/crypto_lx';

describe('LX gzip envelope bounds', () => {
  it('round-trips compressed payloads under the inflated limit', async () => {
    const payload = JSON.stringify({ hello: 'world', n: 42 });
    // Force compression path by padding over 1024 chars.
    const big = payload + 'x'.repeat(2000);
    const encoded = await encodeData(big);
    expect(encoded.startsWith('cg_')).toBe(true);
    await expect(decodeData(encoded)).resolves.toBe(big);
  });

  it('rejects gzip bombs before accepting oversized inflated output', async () => {
    // Highly compressible zeros: tiny gzip, large inflated size past the 2 MiB cap.
    const bombRaw = new Uint8Array(LX_WS_MAX_INFLATED_BYTES + 64 * 1024);
    const compressed = pako.gzip(bombRaw);
    expect(compressed.byteLength).toBeLessThan(LX_WS_MAX_INFLATED_BYTES);
    const frame = `cg_${bytesToBase64(compressed)}`;
    await expect(decodeData(frame)).rejects.toThrow(/inflated frame too large|gzip decode failed/);
  });
});
