# Changelog

## Unreleased

### Changed

- Disabled simulated speaker seek for MIoT URL playback until a real device-level seek command is verified.
- Added `can_seek` and `seek_strategy` to speaker player status so the UI can treat progress seek as a capability.
- Updated speaker progress interactions to stay display-only when seek is unsupported and to send a single seek request when future seek support is enabled.
- Restored the speaker playlist count badge in the main speaker playlist browser while keeping the drawer layout compact.

### Tests

- Added regression coverage for unsupported seek behavior, status capability flags, frontend progress seek gating, and the speaker playlist count badge.
