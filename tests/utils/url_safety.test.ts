import { describe, expect, it } from 'vitest';
import { isBlockedHostname, validateOutboundWebhookUrl } from '../../src/utils/url_safety';

describe('isBlockedHostname', () => {
  it('blocks loopback and private IPv4 literals', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
    expect(isBlockedHostname('10.0.0.1')).toBe(true);
    expect(isBlockedHostname('192.168.1.1')).toBe(true);
    expect(isBlockedHostname('172.16.5.1')).toBe(true);
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('localhost')).toBe(true);
  });

  it('allows public hosts', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('8.8.8.8')).toBe(false);
    expect(isBlockedHostname('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks multicast, reserved, and documentation IPv4 ranges', () => {
    expect(isBlockedHostname('224.0.0.1')).toBe(true);
    expect(isBlockedHostname('240.0.0.1')).toBe(true);
    expect(isBlockedHostname('192.0.2.1')).toBe(true);
    expect(isBlockedHostname('198.51.100.1')).toBe(true);
    expect(isBlockedHostname('203.0.113.1')).toBe(true);
    expect(isBlockedHostname('198.18.0.1')).toBe(true);
    expect(isBlockedHostname('255.255.255.255')).toBe(true);
  });

  it('blocks IPv6 loopback, ULA, link-local, multicast, docs, and mapped private', () => {
    expect(isBlockedHostname('::1')).toBe(true);
    expect(isBlockedHostname('::')).toBe(true);
    expect(isBlockedHostname('fc00::1')).toBe(true);
    expect(isBlockedHostname('fd12:3456:789a::1')).toBe(true);
    expect(isBlockedHostname('fe80::1')).toBe(true);
    expect(isBlockedHostname('ff02::1')).toBe(true);
    expect(isBlockedHostname('2001:db8::1')).toBe(true);
    expect(isBlockedHostname('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedHostname('::ffff:192.168.0.1')).toBe(true);
  });
});

describe('validateOutboundWebhookUrl', () => {
  it('accepts https public URLs', () => {
    const result = validateOutboundWebhookUrl('https://hooks.example.com/path');
    expect(result).toEqual({ ok: true, url: 'https://hooks.example.com/path' });
  });

  it('rejects missing url, non-http schemes, and private hosts', () => {
    expect(validateOutboundWebhookUrl('').ok).toBe(false);
    expect(validateOutboundWebhookUrl('ftp://example.com').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://127.0.0.1/hook').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://192.168.0.10/x').ok).toBe(false);
    expect(validateOutboundWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
  });
});
