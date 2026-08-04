# MIoT Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the five behavior defects found when reviewing `codex/sync-miot-v2026-8-3` against `origin/main`, with regression coverage.

**Architecture:** Keep fixes at the existing ownership boundaries: device resume/pause semantics stay in the playlist manager and Mina client, conversation response validation and polling liveness stay in the monitor/client, and playlist loading commits only after operation-epoch validation. No API redesign beyond the smallest result distinction needed to prevent stale fallbacks.

**Tech Stack:** TypeScript, Vitest, Songloft plugin SDK.

## Global Constraints

- Preserve the existing MIoT route contracts and Starlight-specific playback behavior.
- Do not weaken truthful device status reporting.
- A stale control operation must never issue a new device playback command.
- `null` conversation results remain fetch/response failures; `[]` is reserved for a validated successful empty response.
- Every production change gets a focused regression test that fails before the implementation change.

---

### Task 1: Guard stale resume fallback

**Files:**
- Modify: `src/player/manager.ts`
- Modify: `src/handlers/device.ts`
- Test: `tests/handlers/device.test.ts`
- Test: `tests/player/pause_resume.test.ts`

- [x] Add a test where `resumePlayback()` is superseded by stop and assert `/mina/resume` does not call `replayCurrent()`.
- [x] Run the focused tests and capture the expected failure.
- [x] Make resume fallback conditional on the operation still being current and the manager still having a resumable managed state.
- [x] Run the focused tests to GREEN.

### Task 2: Preserve truthful pause results

**Files:**
- Modify: `src/mina/client.ts`
- Test: `tests/mina/playback_api.test.ts`

- [x] Add tests for unknown status (`-1`) and stop-escalation failure; assert they do not resolve as confirmed `paused`.
- [x] Run the Mina playback tests and capture RED.
- [x] Distinguish unknown/failed verification from confirmed non-playing status while preserving normal pause and successful stop escalation.
- [x] Run Mina, service, and manager pause tests to GREEN.

### Task 3: Reject malformed conversation envelopes

**Files:**
- Modify: `src/mina/client.ts`
- Modify: `src/conversation/monitor.ts` only if required by the regression test.
- Test: `tests/mina/conversation_answer.test.ts`
- Test: `tests/conversation/monitor.test.ts`

- [x] Add a test for HTTP 200 with a non-zero/missing envelope code or missing records, followed by a valid historical batch; assert the first response does not prime timestamp zero or replay history.
- [x] Run the conversation tests and capture RED.
- [x] Validate the direct Xiaoai response envelope and return `null` for malformed/error responses; only validated empty records return `[]`.
- [x] Run conversation tests and typecheck to GREEN.

### Task 4: Keep initial priming live under hung requests

**Files:**
- Modify: `src/mina/client.ts`
- Modify: `src/conversation/monitor.ts`
- Test: `tests/conversation/monitor.test.ts`

- [x] Add a test with a never-resolving initial fetch and assert the monitor still schedules later polling or times out the device request.
- [x] Run the monitor test and capture RED.
- [x] Add a bounded conversation fetch timeout and ensure one device cannot prevent interval installation or other devices from polling.
- [x] Run monitor and Mina tests to GREEN.

### Task 5: Commit playlist loads only for the current operation

**Files:**
- Modify: `src/player/manager.ts`
- Test: `tests/player/playback_target_contract.test.ts`

- [x] Add a delayed A/B playlist-load test proving the late A response cannot replace B's queue.
- [x] Run the playback contract tests and capture RED.
- [x] Return loaded songs as local data and assign `this.songs` only after the caller's epoch check.
- [x] Run playback tests to GREEN.

### Final Verification

- [x] Run all focused regression suites.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run validate`, and `git diff --check`.
- [x] Confirm `git status --short` and summarize any remaining risks.
