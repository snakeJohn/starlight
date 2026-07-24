# Changelog

## Unreleased

### Security

- LX `/ah` rate limiting no longer trusts client-supplied `x-starlight-trust-proxy`; only host-injected `req.trustedProxy` honors forwarded client IPs.
- Conversation webhooks reject non-http(s) URLs and loopback/private/link-local IP literals (SSRF reduction).
- Secret generation (`randomHex` / LX passwords) fails closed when no CSPRNG is available instead of falling back to `Math.random`.

### Fixed

- Plugin `onDeinit` now disables the voice engine and drops live LX sync WebSocket peers so hot-reload does not leave orphan connections.
- Conversation monitor no longer emits per-second `info` logs when devices return zero messages.
- Voice “播放歌单” no longer fails silently on Music API devices (LX05/LX06/L15A 等): `player_play_music` now falls back to `player_play_url`, playlist load retries once, stale playlist IDs re-match after index refresh, and failures speak TTS feedback.
- Built-in “暂停/停止” keywords always match even when saved voice commands omit them, avoiding smart-resume replaying the current song.
- Auto-next retries the current song then skips on device timeout; status polling no longer delays auto-next near the end of a track.
- `validateToken` now checks `device_list code===0` instead of treating an empty array from failed requests as valid (token false-positive).
- Cover URL auth only attaches `access_token` to same-origin Songloft cover paths (blocks foreign-origin path spoofing).
- Pause freezes elapsed progress so resume after a long pause no longer burns remaining auto-next time.
- Schedule update is a real patch: omitting `action`/`params` no longer clears the stored action.
- Config storage updates are serialized per key to reduce lost concurrent writes.
- LX WebSocket gzip decode streams with an inflated-size cap to limit gzip-bomb memory use.

### Changed

- Disabled simulated speaker seek for MIoT URL playback until a real device-level seek command is verified.
- Added `can_seek` and `seek_strategy` to speaker player status so the UI can treat progress seek as a capability.
- Updated speaker progress interactions to stay display-only when seek is unsupported and to send a single seek request when future seek support is enabled.
- Restored the speaker playlist count badge in the main speaker playlist browser while keeping the drawer layout compact.

### Tests

- Added regression coverage for unsupported seek behavior, status capability flags, frontend progress seek gating, and the speaker playlist count badge.
