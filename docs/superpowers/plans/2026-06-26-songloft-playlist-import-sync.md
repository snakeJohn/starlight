# Songloft Playlist Import Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LX source URL resolution compatible with LX Music Desktop and let Starlight import/search/list/ranking/custom playlist songs into chosen Songloft playlists.

**Architecture:** Keep source runtime compatibility in `src/music/lx_shim.ts`. Add a focused Songloft playlist service that reuses `BridgeService.importSongsBestEffort()` for remote song import and calls Songloft playlist APIs for native playlist creation/addition. Add one shared frontend target-playlist module so all song surfaces use the same Songloft playlist picker.

**Tech Stack:** TypeScript, Songloft plugin SDK, browser ES modules, Vitest.

## Global Constraints

- Back up current workspace before code changes; backup created at `J:\plugin-backups\starlight\2026-06-26-121945`.
- Keep `_refs/` as local reference only; do not add it to git.
- Use TDD for behavior changes.
- Do not revert unrelated existing worktree changes.
- Preserve existing cover and lyric sync behavior in `BridgeService`.
- Do not call Songloft host APIs directly from frontend; route through plugin backend.

---

### Task 1: LX Shim Compatibility

**Files:**
- Modify: `src/music/lx_shim.ts`
- Test: `tests/music/runtime.test.ts`

**Interfaces:**
- Consumes: LX source scripts expecting `lx.request(url, options, callback)` with callback `(err, resp, body)`.
- Produces: `resp.body` parsed as JSON when possible, `resp.raw` text available, `resp.statusCode` available, request returns a cancel function.

- [x] **Step 1: Write failing test**

Add a test that installs `LX_SHIM`, mocks `fetch()` returning `{"url":"https://audio.example/song.mp3"}`, registers an LX FAQ-style request handler using `resp.body.url`, dispatches `musicUrl`, and expects `dispatchResult.result` to equal that URL.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/music/runtime.test.ts -t "supports LX Desktop request response body parsing"`

Expected before fix: FAIL because dispatch result is `null` or missing URL.

- [x] **Step 3: Implement shim fix**

Update `lx.request` to:
- parse response text as JSON when possible,
- set `resp.body` to parsed JSON or raw text,
- set `resp.raw` to raw text,
- pass parsed body as callback third argument,
- return a cancel function using `AbortController` where available.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/music/runtime.test.ts -t "supports LX Desktop request response body parsing"`

Expected after fix: PASS.

### Task 2: Songloft Playlist Backend

**Files:**
- Create: `src/songloft/playlist_service.ts`
- Modify: `src/handlers/songloft_library.ts`
- Modify: `src/main.ts`
- Test: `tests/handlers/songloft_library.test.ts`

**Interfaces:**
- Produces: `SongloftPlaylistService.listPlaylists()`, `createPlaylist(name)`, `addSongIds(playlistId, songIds)`, `importSongsToPlaylist(input)`, `importSourceSonglist(input)`.
- Consumes: `BridgeService.importSongsBestEffort(songs)` and `PlatformRegistry`.

- [x] **Step 1: Write failing handler tests**

Cover:
- create Songloft playlist through plugin API,
- import `SearchResultSong[]` into existing playlist,
- create playlist by `playlist_name` then import songs,
- whole external songlist import creates a playlist and adds imported songs.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/handlers/songloft_library.test.ts`

Expected before fix: FAIL on missing routes.

- [x] **Step 3: Implement minimal backend service and routes**

Use host token and host URL for HTTP calls where Songloft SDK method is unavailable. Normalize response bodies defensively.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/handlers/songloft_library.test.ts`

Expected after fix: PASS.

### Task 3: Frontend Songloft Target Playlist Picker

**Files:**
- Create: `static/js/music_modules/songloft_playlist_target.js`
- Modify: `static/js/music.js`
- Modify: `static/js/state.js`
- Modify: `static/index.html`
- Test: `tests/ui/static_layout.test.ts`
- Test: `tests/ui/songloft_library.test.ts`

**Interfaces:**
- Produces: `openSongloftPlaylistTarget(songs, options)` and `bindSongloftPlaylistTarget()`.
- Consumes: plugin APIs from Task 2.

- [x] **Step 1: Write failing UI layout tests**

Assert that a single target playlist dialog exists and exposes existing playlist select, new playlist name input, refresh button, and confirm button.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/ui/static_layout.test.ts -t "Songloft target playlist"`

Expected before fix: FAIL because dialog/module does not exist.

- [x] **Step 3: Implement target picker**

Keep the dialog generic; it only receives a song array and posts to `/songloft/playlists/import-songs`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/ui/static_layout.test.ts tests/ui/songloft_library.test.ts`

Expected after fix: PASS.

### Task 4: Wire Search, Songlists, Rankings, Custom Playlists

**Files:**
- Modify: `static/js/music_modules/search.js`
- Modify: `static/js/music_modules/songlists.js`
- Modify: `static/js/music_modules/rankings.js`
- Modify: `static/js/music_modules/custom_playlists.js`
- Modify: `static/js/music_modules/renderers.js`
- Test: `tests/ui/music_search.test.ts`
- Test: `tests/ui/music_songlists_rankings.test.ts`
- Test: `tests/ui/custom_playlists.test.ts`

**Interfaces:**
- Consumes: `openSongloftPlaylistTarget()`.
- Produces: all required song surfaces can send selected songs to Songloft target playlist.

- [x] **Step 1: Write failing UI tests**

Cover search selected songs, songlist whole import, songlist detail selected songs, ranking selected songs, custom playlist detail selected songs.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/ui/music_search.test.ts tests/ui/music_songlists_rankings.test.ts tests/ui/custom_playlists.test.ts`

Expected before fix: FAIL on missing actions.

- [x] **Step 3: Implement wiring**

Add buttons and event handlers without adding row-level playlist selects.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/ui/music_search.test.ts tests/ui/music_songlists_rankings.test.ts tests/ui/custom_playlists.test.ts`

Expected after fix: PASS.

### Task 5: Full Verification and Package

**Files:**
- Build output: `dist/starlight.jsplugin.zip`

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: exit code 0.

- [ ] **Step 3: Build and validate**

Run: `npm run build`
Run: `npm run validate`

Expected: both exit code 0 and package exists at `dist/starlight.jsplugin.zip`.
