# Songlist Layout Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the songlist page around "我的歌单", add collection for discovered playlists, and harden media row rendering for covers and long text.

**Architecture:** Reuse the existing custom playlist import API for collected songlists. Keep changes focused in the static UI layer, with pure helper exports covered by Vitest and no backend schema changes.

**Tech Stack:** Static browser JavaScript, CSS, Songloft plugin static HTML, Vitest.

## Global Constraints

- Do not bundle or default any LX music source file.
- Do not read, copy, package, or reference `J:\lx-music-source-paid-1782020522186.js`.
- Hide provider/internal IDs from visible UI.
- Use TDD: every production behavior change starts with a failing test.
- Keep Songloft test environment imports as test data only.

---

### Task 1: Static Songlist Layout

**Files:**
- Modify: `tests/ui/static_layout.test.ts`
- Modify: `static/index.html`

**Interfaces:**
- Produces DOM order: `h2 我的歌单`, `h2 导入歌单`, `h2 搜索歌单`.
- Keeps existing roles: `custom-playlist-list`, `custom-playlist-import-form`, `songlist-form`, `songlist-list`, `songlist-detail`.

- [ ] **Step 1: Write the failing test**

Add a test that reads `static/index.html`, finds the three section headings, and expects their indexes to be ascending.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/ui/static_layout.test.ts`
Expected: FAIL because the page still shows `自建歌单` and the search form appears above playlist management.

- [ ] **Step 3: Implement minimal layout**

Move the songlist search form into a bottom `搜索歌单` section. Rename `自建歌单` to `我的歌单`. Keep `导入歌单` between those sections.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/ui/static_layout.test.ts`
Expected: PASS.

### Task 2: Media Rendering Helpers

**Files:**
- Modify: `tests/ui/music_rendering.test.ts`
- Modify: `static/js/music.js`
- Modify: `static/css/style.css`

**Interfaces:**
- Produces `cleanDisplayText(value: unknown): string`.
- Extends `mediaCoverUrl(item): string`.
- Updates `renderArtwork(item, alt)` to include image error fallback.
- Updates `renderSongRow(song, index, extraActions?)` labels to `播放` and `导入 Songloft 歌曲库`.
- Updates `renderSongListItem(item, index)` to render a row with detail and collection actions.

- [ ] **Step 1: Write failing rendering tests**

Add tests for `picUrl`, `imgurl`, nested source cover fields, literal `\\u003cbr\\u003e` cleanup, `收藏`, and the new song-row labels.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/ui/music_rendering.test.ts`
Expected: FAIL because these helpers and labels are not implemented.

- [ ] **Step 3: Implement minimal rendering**

Add the helper logic in `static/js/music.js` and row CSS in `static/css/style.css` so artwork stays fixed, text clamps cleanly, and actions wrap without overlap.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/ui/music_rendering.test.ts`
Expected: PASS.

### Task 3: Collect Discovered Songlists

**Files:**
- Modify: `tests/ui/custom_playlists.test.ts`
- Modify: `static/js/music.js`

**Interfaces:**
- Produces `favoriteSongListFromSource(sourceId: string, listId: string): Promise<unknown>`.
- Uses existing API: `POST api/custom-playlists/import` with `{ source_id, id }`.
- The songlist click handler must route `data-action="favorite-songlist"` separately from `data-action="songlist-detail"`.

- [ ] **Step 1: Write failing UI action test**

Test that `favoriteSongListFromSource('kw', '3360244412')` posts to `api/custom-playlists/import` and reloads custom playlists without exposing the ID in rendered row text.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/ui/custom_playlists.test.ts`
Expected: FAIL because the exported helper/action is missing.

- [ ] **Step 3: Implement minimal collection action**

Export `favoriteSongListFromSource`, reuse `importCustomPlaylistFromSource`, add the row button, and wire the list click handler.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/ui/custom_playlists.test.ts`
Expected: PASS.

### Task 4: Verification And Upload

**Files:**
- No planned source files beyond previous tasks.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run validate
```

Expected: all exit 0.

- [ ] **Step 2: Upload to Songloft test environment**

Run:

```bash
npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin --once
```

Expected: plugin uploads and hot-reloads successfully.
