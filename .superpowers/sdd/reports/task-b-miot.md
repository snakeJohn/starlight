# Task B — MIoT 上游对齐报告

**Agent:** B  
**Branch:** `feat/ui-miot-lx-sync`  
**Date:** 2026-07-18  
**Upstream:** `_refs/songloft-plugin-miot` (shallow clone of songloft-org/songloft-plugin-miot)

## Summary

Ported critical speaker/login bugfixes and missing capabilities from songloft-plugin-miot into Starlight-owned miot-derived modules. Starlight-only paths (Bridge, Download, CustomPlaylist, Songloft library, QR non-blocking poll, `starlight:miot:` storage prefix, playlistManagerMap play-url) were preserved. Memory / WS / search-provider registry subsystems were **not** ported.

## File-by-file

### Ported / changed

| File | Change |
|------|--------|
| `src/mina/auth.ts` | STS `clientSign` + `_userIdNeedEncrypt`; prefer Set-Cookie `serviceToken` over jar; native SHA1 fallback; diagnostic helpers (no secret values) |
| `src/mina/client.ts` | Lyrics/touchscreen Music API path (`searchAudioId`, custom audioId); ubus per-device queue; `isDeviceResultOK`; mibrain TTS + MiIO TTS path; logging; **kept** Starlight `extractConversationAnswerText` |
| `src/mina/constants.ts` | `XIAOMI_IO_SID`, MiIO UA/URL; Music API model list fix (`OH11`/`LX06`); `TTS_COMMAND` + `getTTSCommand` from `tts-commands.json` |
| `src/mina/models.ts` | `MusicSearchResponse` |
| `src/mina/miio_client.ts` | **New** (owned under mina/) — MiIO TTS action client (from miot `miio/client`) |
| `src/mina/tts-commands.json` | **New** — hardware → siid-aiid map |
| `src/utils/debug.ts` | **New** — `isPollDebug` / `setPollDebug` for conversation poll log gate |
| `src/utils/cookie.ts` | `getNames()` for login diagnostics |
| `src/service/service.ts` | `playURL` metadata + cover/lyrics config; device identity + xiaomiio token ensure; TTS options |
| `src/handlers/device.ts` | `POST /mina/stop`, `POST /mina/tts`, `GET /mina/status`; managed refresh try/catch; **kept** playlistManagerMap, parseVolume, last_selected_device |
| `src/handlers/playlist.ts` | Export `getDeviceStatusCache`, `getOrFetchDeviceStatus`, `DEVICE_STATUS_TTL`, inflight dedup |
| `src/handlers/config.ts` | `default_cover_id`, `touchscreen_lyrics_enabled`, `conversation_poll_debug`; await monitor start after save |
| `src/config/manager.ts` | Defaults for speaker keys above; **kept** `starlight:miot:` prefix |
| `src/types.ts` | Optional speaker config fields + `TaskParams.start_position` |
| `src/player/manager.ts` | Pass title/artist to `playURL`; `randomStart`; `isLastPlayNotFound` / stale playlist ID detect |
| `src/player/url_builder.ts` | Loopback URL warn |
| `src/auth/service.ts` | Persist `pass_token` + `startTokenRefresh` on password/captcha success; **kept** non-blocking QR poll |
| `src/schedule/executor.ts` | `start_position` random/resume; playlist ID refresh retry; follow last play mode |
| `src/types/pako.d.ts` | `ungzip` for MiIO decode |
| `tests/player/standalone_queue.test.ts` | Expect metadata arg on `playURL` |
| `tests/config/manager.test.ts` | Assert new speaker defaults |

### Skipped (intentional)

| Area | Reason |
|------|--------|
| `memory/**`, `handlers/memory.ts`, `ws/**` | Out of scope per plan |
| Config: `voice_memory_*`, multi `external_search_sources`, search-provider registry, bare storage keys | Memory / multi-source miot features; Starlight uses bridge + single URL + `starlight:miot:` prefix |
| Wholesale `voicecmd/engine.ts` / `online_searcher.ts` | Starlight larger with Songloft library, custom playlists, download, bridge — only leave as-is this round |
| Wholesale overwrite `player/manager.ts` / `auth/service.ts` | Starlight has more features (standalone queue, diagnostics, QR poll) |
| `handlers/account|auth|conversation|schedule` signature-only miot diffs | No behavior win without main.ts; Starlight schedule holiday mode kept |
| Dropping volume validation | Starlight `parseVolume` / `isValidVolume` retained |

## Test results

```
npm run typecheck  → pass
npx vitest run tests/mina tests/service tests/handlers/device.test.ts \
  tests/handlers/config.test.ts tests/config tests/auth tests/player \
  tests/schedule tests/conversation tests/voicecmd
  → 16 files, 55 tests passed
```

## Risks / follow-ups

1. **MiIO TTS** depends on host crypto (`__go_crypto_*` / `crypto.sha1` etc.) and pako ungzip; falls back to mibrain/mediaplayer if unavailable.
2. **Touchscreen lyrics** hits Xiaomi `/music/search`; needs network + valid mina token; disabled by default.
3. **types.ts** also used by Agent A (LX) — only speaker keys added; merge carefully.
4. **voicecmd multi-source / memory resolver** still diverged from miot; future pass if needed.
5. Frontend UI for `default_cover_id` / `touchscreen_lyrics_enabled` / `conversation_poll_debug` not in Agent B scope (backend works with defaults).
6. `/mina/tts` and `/mina/status` not yet wired in static UI (Agent C).

## Commit

`fix: align miot-derived modules with songloft-plugin-miot`
