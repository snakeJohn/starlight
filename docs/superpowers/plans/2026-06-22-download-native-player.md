# Download Sources And Native Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated download sources, Songloft-backed song downloads, and native-player request playback while removing the plugin mini-player.

**Architecture:** Keep playback and download LX runtimes in separate stores and route all downloads through a dedicated `DownloadService`. Reuse Songloft `/songs/remote` for song ids, then call `songloft.songs.download`; frontend playback sends host-native player requests without modifying `songloft-player`.

**Tech Stack:** TypeScript Songloft plugin SDK, LX source runtime, static browser JavaScript, Vitest.

---

### Task 1: Isolated Source Stores

**Files:**
- Modify: `tests/music/source_manager.test.ts`
- Modify: `src/music/source_store.ts`
- Modify: `src/main.ts`

- [ ] Write a failing test showing custom `SourceStore` keys keep playback and download source metadata/scripts separate.
- [ ] Run `npm test -- tests/music/source_manager.test.ts` and verify the new test fails.
- [ ] Add `SourceStoreOptions` with configurable `indexKey` and `scriptPrefix`.
- [ ] Instantiate separate playback and download stores in `src/main.ts`.
- [ ] Run the source manager test again and verify it passes.

### Task 2: Bridge Import Song IDs

**Files:**
- Modify: `tests/bridge/service.test.ts`
- Modify: `src/bridge/mapper.ts`
- Modify: `src/bridge/service.ts`

- [ ] Write failing tests that `/songs/remote` success bodies are parsed and returned as `songs`.
- [ ] Run `npm test -- tests/bridge/service.test.ts` and verify failure.
- [ ] Parse Songloft import responses, preserve existing payload response shape, and set a Starlight plugin entry path with stable dedup keys.
- [ ] Run the bridge tests and verify they pass.

### Task 3: Download Service And Routes

**Files:**
- Modify: `tests/helpers/songloft.ts`
- Create: `tests/download/service.test.ts`
- Create: `tests/download/handlers.test.ts`
- Create: `src/download/service.ts`
- Create: `src/handlers/download.ts`
- Modify: `src/main.ts`

- [ ] Write failing service tests for settings, isolated URL resolution, single download, and batch progress.
- [ ] Write failing route tests for `/api/download/sources`, `/api/download/settings`, `/api/download/song`, and batch progress.
- [ ] Run `npm test -- tests/download/service.test.ts tests/download/handlers.test.ts` and verify failure.
- [ ] Implement `DownloadService` and register download routes using the download `SourceManager` and `RuntimeManager`.
- [ ] Run the download tests and verify they pass.

### Task 4: Static UI And Native Playback Adapter

**Files:**
- Modify: `tests/ui/static_layout.test.ts`
- Modify: `tests/ui/music_songlist_actions.test.ts`
- Modify: `static/index.html`
- Create: `static/js/native_player.js`
- Modify: `static/js/state.js`
- Modify: `static/js/music.js`
- Modify: `static/css/style.css`

- [ ] Write failing tests that the mini-player is removed, download source UI exists, playback imports songs and sends a native-player request, and song rows include a download action.
- [ ] Run `npm test -- tests/ui/static_layout.test.ts tests/ui/music_songlist_actions.test.ts` and verify failure.
- [ ] Add the download tab/sections, wire download source management and song download actions, and replace preview audio with the native-player request adapter.
- [ ] Run the UI tests and verify they pass.

### Task 5: Verification, Commit, Push, Test Upload

**Files:**
- No additional planned source files.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run validate`.
- [ ] Run `npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin --once`.
- [ ] Commit the implementation.
- [ ] Push branch `starlight-implementation` to GitHub.
