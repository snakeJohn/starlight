# Implementation Plan: LX Sync + MIoT + iOS 26 UI

> **For agentic workers:** Three parallel agents with **non-overlapping file ownership**. Spec: `docs/superpowers/specs/2026-07-18-starlight-lx-miot-ui-design.md`. Refs: `_refs/lxserver`, `_refs/songloft-plugin-miot` (local, gitignored).

**Branch:** `feat/ui-miot-lx-sync`

## Global Constraints

- QuickJS / Songloft plugin SDK only; no Node builtins in runtime code.
- Never log secrets. Never commit `_refs/`.
- Preserve existing `data-role` / `data-action` attributes unless renaming is unavoidable and tests updated.
- TDD where practical; run focused tests before claiming done.
- Report file: write status to assigned report path; return short summary only.

---

## Task A — 洛雪歌单同步（Agent A）

**Owns:** `src/lx_sync/**`, `src/handlers/lx_sync.ts`, `tests/lx_sync/**`, `tests/handlers/lx_sync*`, `static/js/music_modules/lx_sync.js`; minimal hooks in `main.ts`, `config/manager.ts`, `types.ts`, `static/index.html` (lx block only), `music.js` init import, `state.js` fields.

### Steps

1. Add types + mapper: LX MusicInfo / ListData → `CustomPlaylist` / `CustomPlaylistSong` (interval parse, platform source_data).
2. Add `LxSyncClient` (login, getList, optional setList) using global `fetch`.
3. Add `LxSyncService` (config storage, connect, pull+import via `CustomPlaylistService` or store).
4. Register HTTP handlers; wire in `main.ts`.
5. Config fields in ConfigManager if needed (or dedicated storage keys).
6. Frontend module: connect form, preview list, pull button, status.
7. Tests with mocked fetch.
8. `npm run typecheck` + focused vitest.

**Done when:** User can configure lxserver, connect, pull playlists into 我的歌单; tests pass.

---

## Task B — MIoT 上游对齐（Agent B）

**Owns:** miot-ported backend modules listed in spec §4; corresponding tests. **Does not touch static/**.

### Steps

1. Diff `_refs/songloft-plugin-miot/src` vs `src` for owned paths; produce short CHANGE notes in report.
2. Port critical fixes in order: `mina/*` → `service` → `handlers/device` → `auth` → `player` → carefully `voicecmd` (keep starlight bridges).
3. Skip memory/ws unless required to compile.
4. Fix tests broken by ports; add regression tests for behavior you change.
5. `npm run typecheck` + focused tests.

**Done when:** Typecheck green for owned modules; speaker/auth/device tests pass; no wholesale delete of starlight features.

---

## Task C — iOS 26 UI 重构（Agent C）

**Owns:** `static/css/style.css`, `static/index.html` structure/classes, `static/js/app.js` chrome, `static/icon.svg`, optional nav icons in `state.js`; **does not break** data-role/action contracts. Leave/create 洛雪同步 panel shell with `data-role` hooks for Agent A module.

### Steps

1. Redesign CSS tokens for Liquid Glass (light/dark, host vars).
2. Restyle shell: side rail, status strip, panels, buttons, lists, modals, player bar, bottom tabs.
3. Improve HTML structure/classes without removing roles.
4. Add empty 洛雪同步 surface on songlists tab with stable data-roles.
5. Update UI tests if selectors need class flexibility (prefer data-role).
6. Write `docs/superpowers/specs/2026-07-18-ui-asset-prompts.md` with GPT-Image-2 prompts.
7. Run `tests/ui/**`.

**Done when:** Visual system is iOS 26-like; layout tests pass; no business logic regressions.

---

## After Parallel Work (Controller)

1. Merge worktrees: B → A → C (resolve conflicts favoring ownership).
2. Full `npm test` + `npm run typecheck`.
3. Dispatch review agents on the combined diff.
4. Fix Critical/Important findings; re-test.
