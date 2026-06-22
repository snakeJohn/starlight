# Login Cover Index UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide password/token login entry points, fill Kuwo ranking song covers, and prevent automation index metrics from being clipped.

**Architecture:** Keep auth backend routes intact and remove only the visible password/token controls from static UI. Add Kuwo album cover enrichment in the Kuwo provider using the existing Kuwo albuminfo endpoint with an instance cache. Fix automation index layout with CSS so metric cards stack vertically and long timestamps wrap.

**Tech Stack:** Songloft plugin SDK, TypeScript, vanilla browser JavaScript, Vitest.

## Global Constraints

- Keep existing account data and backend login/relogin/token compatibility.
- Do not preset any LX source file.
- Do not read, copy, package, or reference paid LX source files.
- Use TDD: write failing tests before production changes.

---

### Task 1: Hide Non-QR Login UI

**Files:**
- Modify: `static/index.html`
- Test: `tests/ui/static_layout.test.ts`

**Interfaces:**
- Produces: visible account login area contains only QR login controls.

- [ ] Add a static layout test that rejects `data-auth-mode="password"`, `data-auth-mode="token"`, `data-role="password-login-form"`, and `data-role="token-login-form"`.
- [ ] Remove the password/token buttons and panels from `static/index.html`.
- [ ] Run `npm test -- tests/ui/static_layout.test.ts`.

### Task 2: Kuwo Ranking Covers

**Files:**
- Modify: `src/music/platforms/providers/kw.ts`
- Test: `tests/music/kuwo_provider.test.ts`

**Interfaces:**
- Produces: `KuwoProvider.leaderboardList()` returns songs with `cover_url` when the rank item has only `albumid`.

- [ ] Add a provider test that mocks `kbangserver.kuwo.cn` and `search.kuwo.cn/r.s?stype=albuminfo`.
- [ ] Add cached album cover lookup keyed by album ID.
- [ ] Run `npm test -- tests/music/kuwo_provider.test.ts`.

### Task 3: Automation Index Metrics

**Files:**
- Modify: `static/css/style.css`
- Test: `tests/ui/static_layout.test.ts`

**Interfaces:**
- Produces: `.automation-layout .metric-grid` stacks metrics vertically and timestamps wrap.

- [ ] Add CSS static tests for vertical metric grid and wrapped metric values.
- [ ] Update CSS selectors.
- [ ] Run `npm test -- tests/ui/static_layout.test.ts`.

### Task 4: Verify and Upload

**Files:**
- No additional source files.

**Interfaces:**
- Produces: updated plugin uploaded to `http://192.168.31.63:18191/`.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run validate`.
- [ ] Upload with `npm run dev -- --host http://192.168.31.63:18191 --username admin --password admin --once`.
