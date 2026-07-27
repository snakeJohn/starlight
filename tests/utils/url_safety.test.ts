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

  it('blocks non-dotted-quad IPv4 literals that still resolve to loopback/private', () => {
    expect(isBlockedHostname('2130706433')).toBe(true);      // decimal 127.0.0.1
    expect(isBlockedHostname('0x7f000001')).toBe(true);      // hex 127.0.0.1
    expect(isBlockedHostname('017700000001')).toBe(true);    // octal 127.0.0.1
    expect(isBlockedHostname('127.1')).toBe(true);           // short form 127.0.0.1
    expect(isBlockedHostname('192.168.257')).toBe(true);     // short form 192.168.1.1
    expect(isBlockedHostname('0')).toBe(true);               // 0.0.0.0
  });

  it('keeps allowing public hosts that merely look numeric', () => {
    expect(isBlockedHostname('134744072')).toBe(false);       // decimal 8.8.8.8
    expect(isBlockedHostname('example123.com')).toBe(false);
    expect(isBlockedHostname('1e10.example.com')).toBe(false);
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

  it('requires https for hostname webhooks while allowing checked public IP literals', () => {
    expect(validateOutboundWebhookUrl('http://hooks.example.com/path').ok).toBe(false);
    expect(validateOutboundWebhookUrl('https://hooks.example.com/path').ok).toBe(true);
    expect(validateOutboundWebhookUrl('http://8.8.8.8/path').ok).toBe(true);
  });

  it('rejects missing url, non-http schemes, and private hosts', () => {
    expect(validateOutboundWebhookUrl('').ok).toBe(false);
    expect(validateOutboundWebhookUrl('ftp://example.com').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://127.0.0.1/hook').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://192.168.0.10/x').ok).toBe(false);
    expect(validateOutboundWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://2130706433/hook').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://0x7f000001/hook').ok).toBe(false);
  });
});
