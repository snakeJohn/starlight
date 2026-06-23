# Starlight Library Playback Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Starlight design for 20-item music lists, batch operations, Songloft library access, voice speaker push, source fallback, plugin global playback, registry publishing, and timestamped versioning.

**Architecture:** Keep the existing plugin boundaries. UI list mechanics stay in `static/js/music.js`, `static/index.html`, and `static/css/style.css`; Songloft data access is wrapped by new plugin handlers; fallback resolution is centralized in bridge/download services; MIoT speaker playback continues through `PlaylistManager`; local plugin playback gets a separate queue module without modifying `songloft-player`.

**Tech Stack:** TypeScript, plain browser ES modules, Vitest, Songloft plugin SDK, Songloft plugin builder.

## Global Constraints

- Do not modify `songloft-player`.
- Do not preset any LX music source or download source.
- Playback sources and download sources must never be used interchangeably.
- Single-song `播放` buttons remain visible and later target the plugin-local playback queue.
- Version format is exactly `V-yyyy.mm.dd.hh.mm`.
- Use TDD for behavior changes: write the failing test, run it, implement, rerun.
- Avoid touching untracked files outside `songloft-plugin-starlight`.

---

### Task 1: UI List Mechanics

**Files:**
- Modify: `static/js/music.js`
- Modify: `static/index.html`
- Modify: `static/css/style.css`
- Test: `tests/ui/music_pagination.test.ts`
- Test: `tests/ui/music_rendering.test.ts`
- Test: `tests/ui/static_layout.test.ts`
- Test: `tests/ui/custom_playlists.test.ts`

**Interfaces:**
- Produces: `renderSongRow(song, index, extraActions?, options?)` supports optional checkboxes while keeping the `播放` action.
- Produces: `renderListScroller(innerHtml, extraClass?)` returns a stable scroll container for long lists.
- Produces: search UI handlers for clear, select current page, clear selection, batch import, batch add to custom playlist, batch download, and batch speaker playback.

- [ ] **Step 1: Write failing UI tests**

Add assertions that page size is 20, search rows can render checkboxes while preserving `播放`, the search section has clear and batch buttons, and list scroll classes exist.

Run:

```powershell
npm test -- tests/ui/music_pagination.test.ts tests/ui/music_rendering.test.ts tests/ui/static_layout.test.ts tests/ui/custom_playlists.test.ts
```

Expected: FAIL because page size helpers, checkbox rendering, search clear/batch markup, and scroll classes are not implemented.

- [ ] **Step 2: Implement UI helpers and markup**

Set all music page sizes to 20, add optional checkbox rendering for search rows, wrap list contents in scroll containers, add clear and batch controls, and wire selection handlers.

- [ ] **Step 3: Verify UI tests pass**

Run:

```powershell
npm test -- tests/ui/music_pagination.test.ts tests/ui/music_rendering.test.ts tests/ui/static_layout.test.ts tests/ui/custom_playlists.test.ts
```

Expected: PASS.

### Task 2: Songloft Library Handlers

**Files:**
- Create: `src/handlers/songloft_library.ts`
- Modify: `src/main.ts`
- Test: `tests/handlers/songloft_library.test.ts`

**Interfaces:**
- Produces: `registerSongloftLibraryHandlers(router, bridgeService?)`.
- Produces routes: `GET /api/songloft/songs`, `GET /api/songloft/playlists`, `GET /api/songloft/playlists/:id/songs`, `GET /api/songloft/local-songs`.

- [ ] **Step 1: Write failing handler tests**

Test that handlers call `songloft.songs.list`, `songloft.playlists.list`, and `songloft.playlists.getSongs`, normalize paging, and filter local songs.

Run:

```powershell
npm test -- tests/handlers/songloft_library.test.ts
```

Expected: FAIL because the handler file and routes do not exist.

- [ ] **Step 2: Implement handlers and route registration**

Add the handler module, normalize arrays and `{ list, total }` style responses, and register it in `src/main.ts`.

- [ ] **Step 3: Verify handler tests pass**

Run:

```powershell
npm test -- tests/handlers/songloft_library.test.ts
```

Expected: PASS.

### Task 3: Songloft Library UI and Speaker Push

**Files:**
- Modify: `static/index.html`
- Modify: `static/js/music.js`
- Modify: `static/js/state.js`
- Test: `tests/ui/songloft_library.test.ts`

**Interfaces:**
- Consumes: `/api/songloft/songs`, `/api/songloft/playlists`, `/api/songloft/playlists/:id/songs`, `/api/songloft/local-songs`.
- Produces UI for Songloft songs, Songloft playlists, playlist songs, and local songs with speaker push buttons.

- [ ] **Step 1: Write failing UI tests**

Assert that Songloft library controls exist and speaker push calls the existing MIoT bridge payload format.

Run:

```powershell
npm test -- tests/ui/songloft_library.test.ts
```

Expected: FAIL because the UI is absent.

- [ ] **Step 2: Implement UI**

Add state fields, rendering, paging, and click handlers.

- [ ] **Step 3: Verify UI tests pass**

Run:

```powershell
npm test -- tests/ui/songloft_library.test.ts
```

Expected: PASS.

### Task 4: Voice Command Songloft Matching

**Files:**
- Modify: `src/indexing/manager.ts`
- Modify: `src/voicecmd/engine.ts`
- Test: `tests/voicecmd/songloft_library.test.ts`

**Interfaces:**
- Produces voice matching priority: custom playlist, Songloft playlist, Songloft/local song, online fallback.
- Consumes Songloft playlist and song SDK calls.

- [ ] **Step 1: Write failing voice tests**

Test `播放歌单 xxx` matches Songloft playlists after custom playlists and `播放歌曲 xxx` matches local songs before online fallback.

Run:

```powershell
npm test -- tests/voicecmd/songloft_library.test.ts
```

Expected: FAIL because the matching path is absent.

- [ ] **Step 2: Implement matching**

Add Songloft lookup helpers and local song URL conversion through `/songs/{id}/play`.

- [ ] **Step 3: Verify voice tests pass**

Run:

```powershell
npm test -- tests/voicecmd/songloft_library.test.ts
```

Expected: PASS.

### Task 5: Playback and Download Fallback

**Files:**
- Modify: `src/bridge/service.ts`
- Modify: `src/download/service.ts`
- Modify: `src/player/manager.ts`
- Test: `tests/bridge/service.test.ts`
- Test: `tests/download/service.test.ts`
- Test: `tests/player/standalone_queue.test.ts`

**Interfaces:**
- Produces: playback fallback searches enabled playback providers only.
- Produces: download fallback searches enabled download runtimes only.

- [ ] **Step 1: Write failing fallback tests**

Test playback falls back after URL resolve failure and download falls back through download runtimes without using playback runtimes.

Run:

```powershell
npm test -- tests/bridge/service.test.ts tests/download/service.test.ts tests/player/standalone_queue.test.ts
```

Expected: FAIL because fallback is not implemented.

- [ ] **Step 2: Implement fallback**

Add bounded candidate search and clear error reporting with attempted source counts.

- [ ] **Step 3: Verify fallback tests pass**

Run:

```powershell
npm test -- tests/bridge/service.test.ts tests/download/service.test.ts tests/player/standalone_queue.test.ts
```

Expected: PASS.

### Task 6: Plugin Local Global Playback

**Files:**
- Create: `static/js/plugin_player.js`
- Modify: `static/js/app.js`
- Modify: `static/js/music.js`
- Modify: `static/js/state.js`
- Modify: `static/css/style.css`
- Test: `tests/ui/plugin_player.test.ts`

**Interfaces:**
- Produces: a plugin-local queue with play, previous, toggle, stop, next, mode, and queue list controls.
- Consumes: single-song `播放` actions from search, songlist detail, ranking detail, and custom playlist detail.

- [ ] **Step 1: Write failing plugin player tests**

Assert that `播放` enqueues songs into plugin local playback and global controls update state.

Run:

```powershell
npm test -- tests/ui/plugin_player.test.ts
```

Expected: FAIL because `plugin_player.js` is absent and `播放` still routes to the native helper.

- [ ] **Step 2: Implement plugin player**

Add queue state, controls, and update existing `previewSong` behavior to target the plugin queue.

- [ ] **Step 3: Verify plugin player tests pass**

Run:

```powershell
npm test -- tests/ui/plugin_player.test.ts
```

Expected: PASS.

### Task 7: Registry and Version Automation

**Files:**
- Create: `registry.json`
- Create: `scripts/update-version.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `plugin.json`
- Test: `tests/release/version.test.ts`
- Test: `tests/release/registry.test.ts`

**Interfaces:**
- Produces: `npm run version:stamp`.
- Produces: repository raw registry pointing at `https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json`.

- [ ] **Step 1: Write failing release tests**

Update version tests for `V-yyyy.mm.dd.hh.mm` and add registry tests.

Run:

```powershell
npm test -- tests/release/version.test.ts tests/release/registry.test.ts
```

Expected: FAIL because the current version lacks `V-` and registry does not exist.

- [ ] **Step 2: Implement registry and version script**

Add `registry.json`, update release metadata fields, and update package scripts.

- [ ] **Step 3: Verify release tests pass**

Run:

```powershell
npm test -- tests/release/version.test.ts tests/release/registry.test.ts
```

Expected: PASS.

### Task 8: Full Verification and GitHub Push

**Files:**
- No new files unless verification exposes defects.

**Interfaces:**
- Consumes all previous task outputs.
- Produces pushed branch and user-facing change summary.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run validate
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect Git status**

Run:

```powershell
git status --short
```

Expected: only intentional files are modified; unrelated `../README.md` and `../Typora_Hook_Log.txt` remain untouched.

- [ ] **Step 3: Commit and push**

Run:

```powershell
git add .
git commit -m "feat: implement starlight library playback workflow"
git push origin starlight-implementation
```

Expected: push succeeds. Final response includes modified feature summary, new interfaces, UI behavior changes, version, verification commands, branch, and commit.
