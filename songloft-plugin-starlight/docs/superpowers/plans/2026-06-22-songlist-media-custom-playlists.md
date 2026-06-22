# Songlist Media Custom Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cover-rich music discovery rows, hidden provider IDs, whole-songlist playback, and custom playlists with source-retaining UI and voice creation/add-song commands.

**Architecture:** Keep platform search/detail endpoints intact. Add focused UI helper exports for media row rendering and playlist actions. Add a custom playlist service that prefers Songloft native playlist writes and falls back to plugin storage, then teach indexing/voice to see fallback playlists.

**Tech Stack:** TypeScript, Songloft plugin SDK, static browser JavaScript, Vitest.

## Global Constraints

- Do not bundle or default any LX music source file.
- Do not read, copy, package, or reference `J:\lx-music-source-paid-1782020522186.js`.
- Preserve full `source_data` for saved custom playlist songs.
- Hide provider/internal IDs from visible UI.
- Use TDD: every production behavior change starts with a failing test.
- Keep current Songloft test environment imports as test data only.

---

## File Structure

- Modify `static/js/music.js`: media row rendering, custom playlist UI actions, whole-songlist playback helper exports.
- Modify `static/css/style.css`: stable media row layout with artwork and wrapping actions.
- Modify `static/index.html`: custom playlist panel and detail actions.
- Create `src/custom_playlists/types.ts`: custom playlist and song interfaces.
- Create `src/custom_playlists/store.ts`: storage fallback.
- Create `src/custom_playlists/service.ts`: native-write-first custom playlist service.
- Create `src/handlers/custom_playlists.ts`: plugin API routes for custom playlists.
- Modify `src/main.ts`: instantiate/register custom playlist service.
- Modify `src/indexing/manager.ts`: merge fallback custom playlists into voice/playback index.
- Modify `src/voicecmd/engine.ts`: new voice command types and execution.
- Modify `src/voicecmd/ai_analyzer.ts`: AI schema prompt extension.
- Modify `src/types.ts`: voice command and AI param typing.
- Modify `tests/helpers/songloft.ts`: mock playlist write surface.
- Add or extend tests under `tests/ui`, `tests/custom_playlists`, `tests/indexing`, and `tests/voicecmd`.

---

### Task 1: Media Row Rendering And Hidden IDs

**Files:**
- Modify: `static/js/music.js`
- Modify: `static/css/style.css`
- Test: `tests/ui/music_rendering.test.ts`

**Interfaces:**
- Produces: `mediaCoverUrl(item): string`, `sourceDisplayName(platform): string`, `renderSongRow(song, index, extraActions?: string): string`, `renderSongLists(items): void`, `renderRankingBoards(boards): string`.

- [ ] **Step 1: Write failing rendering tests**

Create `tests/ui/music_rendering.test.ts` with tests that import `static/js/music.js` and assert:

```ts
expect(renderSongRow(songWithCover, 0)).toContain('https://img.test/song.jpg');
expect(renderSongRow(songWithCover, 0)).toContain('晴天');
expect(renderSongRow(songWithCover, 0)).not.toContain('228908');
expect(renderSongListItem({ id: '3360244412', name: '华语热歌', cover_url: 'https://img.test/list.jpg' }, 0)).not.toContain('3360244412');
expect(renderRankingBoard({ id: 'kw__16', name: '酷我热歌榜' }, 0)).not.toContain('kw__16');
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/ui/music_rendering.test.ts`
Expected: FAIL because helper exports/renderers do not exist or still expose IDs.

- [ ] **Step 3: Implement minimal rendering helpers**

Export pure helpers from `static/js/music.js`, change songlist/ranking rendering to use them, and update CSS to:

- `.media-row` grid with `48px minmax(0, 1fr) auto`.
- `.media-artwork` fixed `48px` square.
- Mobile `.media-row` becomes one-column with actions below.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/ui/music_rendering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add static/js/music.js static/css/style.css tests/ui/music_rendering.test.ts
git commit -m "feat: render music media rows"
```

---

### Task 2: Whole Songlist Playback Helper

**Files:**
- Modify: `static/js/music.js`
- Modify: `static/index.html`
- Test: `tests/ui/music_songlist_actions.test.ts`

**Interfaces:**
- Produces: `playSonglistOnSpeaker(songs: SearchResultSong[]): Promise<unknown>`.
- Uses existing API calls: `POST /bridge/songs/import`, then `POST /bridge/play-url` with the first song and `selectedDevicePayload()`.

- [ ] **Step 1: Write failing action tests**

Test that `playSonglistOnSpeaker([songA, songB])` calls import first, then play-url for `songA`. Test empty list rejects with `歌单没有可播放歌曲`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/ui/music_songlist_actions.test.ts`
Expected: FAIL because helper/action is missing.

- [ ] **Step 3: Implement minimal action**

Add the helper and a `播放整个歌单` button next to `导入当前歌单` in songlist detail. Reuse existing `selectedDevicePayload`, `importSongs`, `playOnSpeaker`, and toast behavior.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/ui/music_songlist_actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add static/js/music.js static/index.html tests/ui/music_songlist_actions.test.ts
git commit -m "feat: play whole discovered songlists"
```

---

### Task 3: Custom Playlist Storage And Native-Write Fallback

**Files:**
- Create: `src/custom_playlists/types.ts`
- Create: `src/custom_playlists/store.ts`
- Create: `src/custom_playlists/service.ts`
- Modify: `tests/helpers/songloft.ts`
- Test: `tests/custom_playlists/service.test.ts`

**Interfaces:**
- `CustomPlaylistService.list(): Promise<CustomPlaylist[]>`
- `CustomPlaylistService.create(name: string): Promise<CustomPlaylist>`
- `CustomPlaylistService.addSong(playlistName: string, song: SearchResultSong): Promise<CustomPlaylist>`
- `CustomPlaylistService.rename(id: string, name: string): Promise<CustomPlaylist>`
- `CustomPlaylistService.delete(id: string): Promise<{ id: string }>`
- `CustomPlaylistStore` persists under `starlight:custom_playlists:index`.

- [ ] **Step 1: Write failing service tests**

Assert:

- Creating the same name twice returns the existing playlist.
- Adding `稻花香` from `kw` stores `source_name: "酷我"` and the full `source_data`.
- Adding the same song twice dedupes by `platform + stable song id`.
- When `songloft.playlists.create` or `songloft.playlists.addSongs` is absent/throws, fallback storage still succeeds.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/custom_playlists/service.test.ts`
Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement minimal service**

Implement storage fallback and best-effort native calls. Probe optional host methods defensively:

```ts
const maybeCreate = (songloft.playlists as any).create;
const maybeAddSongs = (songloft.playlists as any).addSongs;
```

Use `BridgeService.importSongs([song])` or shared remote-song mapping to ensure Songloft remote songs receive preserved `source_data`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/custom_playlists/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/custom_playlists tests/custom_playlists tests/helpers/songloft.ts
git commit -m "feat: add custom playlist service"
```

---

### Task 4: Custom Playlist API And UI

**Files:**
- Create: `src/handlers/custom_playlists.ts`
- Modify: `src/main.ts`
- Modify: `static/index.html`
- Modify: `static/js/music.js`
- Modify: `static/css/style.css`
- Test: `tests/custom_playlists/handlers.test.ts`
- Test: `tests/ui/custom_playlists.test.ts`

**Interfaces:**
- `GET /api/custom-playlists`
- `POST /api/custom-playlists`
- `PUT /api/custom-playlists/:id`
- `DELETE /api/custom-playlists/:id`
- `POST /api/custom-playlists/:id/songs`

- [ ] **Step 1: Write failing handler tests**

Assert routes validate names/songs and delegate to `CustomPlaylistService`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/custom_playlists/handlers.test.ts`
Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement handler and main registration**

Register handlers under the plugin `/api` router after bridge/music handlers.

- [ ] **Step 4: Run handler GREEN**

Run: `npm test -- tests/custom_playlists/handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing UI tests**

Assert the UI adds an `加入歌单` action for song rows and posts to `/custom-playlists/:id/songs` with the selected custom playlist.

- [ ] **Step 6: Run UI RED**

Run: `npm test -- tests/ui/custom_playlists.test.ts`
Expected: FAIL because UI controls are missing.

- [ ] **Step 7: Implement minimal UI**

Add a custom playlist panel with create/select/list controls. Add `加入歌单` actions to search/detail/ranking song rows.

- [ ] **Step 8: Run UI GREEN**

Run: `npm test -- tests/ui/custom_playlists.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/handlers/custom_playlists.ts src/main.ts static/index.html static/js/music.js static/css/style.css tests/custom_playlists/handlers.test.ts tests/ui/custom_playlists.test.ts
git commit -m "feat: manage custom playlists from music UI"
```

---

### Task 5: Indexing Custom Playlist Fallbacks

**Files:**
- Modify: `src/indexing/manager.ts`
- Modify: `src/main.ts`
- Test: `tests/indexing/custom_playlists.test.ts`

**Interfaces:**
- `IndexingManager` optionally receives `CustomPlaylistService`.
- Fallback custom playlists are merged into `searchPlaylist`, `findPlaylistByName`, `findSongByName`, and status counts.

- [ ] **Step 1: Write failing indexing tests**

Assert a storage-only custom playlist named `古风` can be found by `findPlaylistByName('古风')`, and `findSongByName('为龙')` returns its playlist location.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/indexing/custom_playlists.test.ts`
Expected: FAIL because indexing ignores custom storage.

- [ ] **Step 3: Implement minimal index merge**

During `refresh()`, append custom fallback playlists and songs after native playlists. Use stable negative or high synthetic IDs only for fallback playback routing, and keep real native IDs when Songloft write succeeds.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/indexing/custom_playlists.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/indexing/manager.ts src/main.ts tests/indexing/custom_playlists.test.ts
git commit -m "feat: index custom playlist fallbacks"
```

---

### Task 6: Voice Create Playlist And Add Song

**Files:**
- Modify: `src/types.ts`
- Modify: `src/voicecmd/engine.ts`
- Modify: `src/voicecmd/ai_analyzer.ts`
- Modify: `src/main.ts`
- Test: `tests/voicecmd/custom_playlists.test.ts`

**Interfaces:**
- New command types: `create_playlist`, `add_song_to_playlist`.
- Voice add-song uses platform name mapping: `酷我 -> kw`, `酷狗 -> kg`, `QQ音乐 -> tx`, `咪咕 -> mg`, `网易云 -> wy`.

- [ ] **Step 1: Write failing voice tests**

Assert:

- `创建歌单 古风` calls `customPlaylistService.create('古风')`.
- `把为龙 河图 酷狗 加到古风` searches `kg` first, adds the first match to `古风`, refreshes index, and uses TTS success.
- If the source name is unknown, it speaks `未找到音源`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/voicecmd/custom_playlists.test.ts`
Expected: FAIL because voice commands are unsupported.

- [ ] **Step 3: Implement minimal voice support**

Extend command priority, defaults, rule matching execution, AI prompt/result handling, and constructor injection for `CustomPlaylistService` and `PlatformRegistry`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/voicecmd/custom_playlists.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/types.ts src/voicecmd/engine.ts src/voicecmd/ai_analyzer.ts src/main.ts tests/voicecmd/custom_playlists.test.ts
git commit -m "feat: create custom playlists by voice"
```

---

### Task 7: Final Verification And Test Environment Acceptance

**Files:**
- Modify: `.superpowers/sdd/progress.md` if task status tracking needs updating.

- [ ] **Step 1: Run full local verification**

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

Expected: updated plugin id `7` or new reported id with successful hot reload.

- [ ] **Step 3: API acceptance**

Use the existing imported test sources only as test data. Verify:

- All sources remain not bundled and not default-enabled.
- Create custom playlist `古风测试`.
- Add `为龙 - 河图（酷狗）` and `稻花香 - 周杰伦（酷我）` from search results.
- Saved list displays source names, not raw platform IDs.
- Whole-songlist playback imports then plays the first song when a speaker is selected.

- [ ] **Step 4: Commit final integration if needed**

Run:

```bash
git status --short
git add <changed-files>
git commit -m "test: verify custom playlist acceptance"
```

Only commit if Step 3 required committed test/docs changes.

