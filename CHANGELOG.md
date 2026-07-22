# Changelog

## Unreleased

### Security

- LX `/ah` rate limiting no longer trusts client-supplied `x-starlight-trust-proxy`; only host-injected `req.trustedProxy` honors forwarded client IPs.
- Conversation webhooks reject non-http(s) URLs and loopback/private/link-local IP literals (SSRF reduction).
- Secret generation (`randomHex` / LX passwords) fails closed when no CSPRNG is available instead of falling back to `Math.random`.

### Fixed

- Plugin `onDeinit` now disables the voice engine and drops live LX sync WebSocket peers so hot-reload does not leave orphan connections.
- Conversation monitor no longer emits per-second `info` logs when devices return zero messages.

### Changed

- Disabled simulated speaker seek for MIoT URL playback until a real device-level seek command is verified.
- Added `can_seek` and `seek_strategy` to speaker player status so the UI can treat progress seek as a capability.
- Updated speaker progress interactions to stay display-only when seek is unsupported and to send a single seek request when future seek support is enabled.
- Restored the speaker playlist count badge in the main speaker playlist browser while keeping the drawer layout compact.

### Tests

- Added regression coverage for unsupported seek behavior, status capability flags, frontend progress seek gating, and the speaker playlist count badge.
