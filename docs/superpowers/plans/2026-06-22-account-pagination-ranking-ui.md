# Account Pagination Ranking UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account relogin/delete actions, fix Kugou rankings, add pagination to music list surfaces, and tighten UI layout.

**Architecture:** Keep backend changes limited to the Kugou provider and existing account APIs. Add reusable front-end pagination helpers in `static/js/music.js`, and use existing state/render patterns for search, songlists, songlist detail, and rankings. Keep UI-only layout changes in `static/index.html`, `static/js/app.js`, `static/js/speaker.js`, and `static/css/style.css`.

**Tech Stack:** Songloft plugin SDK, TypeScript, vanilla browser JavaScript, Vitest.

## Global Constraints

- Do not preset any LX source file.
- Do not read, copy, package, or reference the paid LX source file.
- Hide platform ID chips and music/playlist/ranking IDs from normal UI labels.
- Use existing UI patterns and keep controls interactive rather than JSON-based.

---

### Task 1: Account Actions

**Files:**
- Modify: `static/js/speaker.js`
- Test: `tests/ui/speaker_controls.test.ts`

**Interfaces:**
- Consumes: existing `/miot/auth/relogin` and `DELETE /miot/account?account_id=...`.
- Produces: account row buttons with `data-action="relogin-account"` and `data-action="delete-account"`.

- [ ] Write failing UI tests for account action rendering.
- [ ] Implement account row selected styling, relogin, and delete handlers.
- [ ] Run `npm test -- tests/ui/speaker_controls.test.ts`.

### Task 2: Kugou Rankings

**Files:**
- Modify: `src/music/platforms/providers/kg.ts`
- Test: `tests/music/kugou_provider.test.ts`

**Interfaces:**
- Consumes: `fetchJson<T>(url)` from `src/music/platforms/http.ts`.
- Produces: `KugouProvider.leaderboardList()` backed by `mobilecdnbj.kugou.com/api/v3/rank/song`.

- [ ] Write failing provider test that expects mobile Kugou rank songs.
- [ ] Implement the provider URL and mapping for `data.info`.
- [ ] Run `npm test -- tests/music/kugou_provider.test.ts`.

### Task 3: Pagination

**Files:**
- Modify: `static/index.html`
- Modify: `static/js/music.js`
- Modify: `static/css/style.css`
- Test: `tests/ui/static_layout.test.ts`
- Test: `tests/ui/music_pagination.test.ts`

**Interfaces:**
- Produces: reusable pagination markup with `data-pagination`, `data-page-action`, and `data-role="*-page-input"`.

- [ ] Write failing tests for pagination markup and helper output.
- [ ] Add pagination controls to search results, songlist list, songlist detail, and ranking songs.
- [ ] Run the UI tests.

### Task 4: Layout and Copy

**Files:**
- Modify: `static/js/app.js`
- Modify: `static/index.html`
- Modify: `static/css/style.css`
- Test: `tests/ui/static_layout.test.ts`
- Test: `tests/ui/voice_command_editor.test.ts`

**Interfaces:**
- Produces: no top status platform chip, narrower ranking boards column, wider voice command column, wrapping voice command controls, and clearer add-to-playlist target hint.

- [ ] Write failing static tests for hidden platform chip and layout class hooks.
- [ ] Implement markup and CSS changes.
- [ ] Run targeted UI tests.

### Task 5: Full Verification and Upload

**Files:**
- No new files beyond task tests.

**Interfaces:**
- Produces: updated plugin zip uploaded to `http://192.168.31.63:18191/`.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run validate`.
- [ ] Upload with `npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin --once`.
