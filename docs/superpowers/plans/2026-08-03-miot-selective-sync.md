# MIoT v2026.8.3 Selective Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selectively port four correctness and compatibility improvements from `songloft-plugin-miot` v2026.8.3 into Starlight, without overwriting Starlight's independently evolved player, UI, bridge, download, or search behavior.

**Architecture:** Each change is adapted at Starlight's existing ownership boundary: conversation polling stays in `ConversationMonitor`/`MinaHTTPClient`, playlist targeting stays in `PlaylistManager` plus the speaker routes and modules, verified pause stays in the Mina client/service/manager chain, and radio transcoding stays an opt-in configuration passed into `URLBuilder`. Every task begins with a focused regression test that fails for the missing behavior, then adds only the minimum production change and receives a task-scoped review.

**Tech Stack:** TypeScript 5.9, Vitest 3, Songloft plugin SDK, browser ES modules, Git.

## Global Constraints

- Upstream reference is `songloft-org/songloft-plugin-miot` tag `v2026.8.3` (`dce439d52b1a71ad48f8f53b7d88d76ef50be152`); the approximate Starlight sync baseline is upstream tag `v2026.7.18` (`ef42dceb77301ddf98d08e5de9e1b6252b330f3c`).
- Preserve Starlight-specific validation, status truthfulness, pause progress accounting, browser modules, dynamic playlists, bridge behavior, downloads, external search, diagnostics, and response projections.
- Implement only: server-timestamp conversation priming, `song_id` playlist targeting, verified pause with stop fallback, and opt-in `radio_force_mp3`.
- Do not add WebF, slider shims, Blob/Data URL covers, seek-based resume, volume normalization, multi-room groups, artist playback, favorite-current-song, or `/voice-commands/said`.
- A hard stop caused by ignored pause must make `PlaylistManager.resumePlayback()` return `false`; existing callers then replay the current URL. Do not add `seek`; replay therefore starts from the beginning.
- `radio_force_mp3` defaults to `false`, remains independent from `force_mp3`, and only adds `radio_transcode=mp3` when `song.type === 'radio'` and the option is enabled.
- Keep `access_token` as the first query parameter added by `URLBuilder`; append `format=mp3` and `radio_transcode=mp3` after it.
- Do not change `plugin.json`, release versions, hashes, registry metadata, or changelog entries in this implementation branch.
- Use TDD for every production behavior: record a focused RED failure before editing production code, then record the GREEN result in the task report.

---

### Task 1: Prime Conversation Deduplication from Xiaomi Server Timestamps

**Files:**
- Modify: `src/conversation/monitor.ts`
- Modify: `src/mina/client.ts`
- Test: `tests/conversation/monitor.test.ts`
- Test: `tests/mina/conversation_answer.test.ts`

**Interfaces:**
- Consumes: `MinaHTTPClient.getLatestAskFromXiaoai(deviceId, hardware, limit)` and Xiaomi/UBus conversation records.
- Produces: `getLatestAskFromXiaoai(...): Promise<AskMessage[] | null>` where `null` means fetch failure and `[]` means a successful empty result; `MonitorStatus.devices[*].primed: boolean`.

- [ ] **Step 1: Write failing monitor tests**

Add behavior tests that use a real `ConversationMonitor` with only its external account/config/client boundaries faked:

```ts
it('primes from the newest server timestamp without replaying history', async () => {
  const history = ask(1_000, '历史口令');
  const current = ask(1_001, '新口令');
  minaClient.getLatestAskFromXiaoai
    .mockResolvedValueOnce([history])
    .mockResolvedValueOnce([history, current]);

  monitor.start();
  await flushStart();
  expect(callback).not.toHaveBeenCalled();
  expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_000 });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: current }));
});

it('does not prime a device when fetching conversations fails', async () => {
  minaClient.getLatestAskFromXiaoai
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce([ask(2_000, '历史口令')])
    .mockResolvedValueOnce([ask(2_001, '新口令')]);
  monitor.start();
  await flushStart();
  expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: false, last_timestamp_ms: 0 });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(callback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(callback).toHaveBeenCalledTimes(1);
});
```

Also update the existing interval/overlap tests for the new immediate priming call, and assert that a successful empty first response sets `primed: true` with baseline `0`.

- [ ] **Step 2: Run monitor tests and capture RED**

Run: `npx vitest run tests/conversation/monitor.test.ts`

Expected: FAIL because the first successful response is currently delivered or because `primed` is absent, and because failed fetches are currently indistinguishable from empty results.

- [ ] **Step 3: Write failing Mina client tests**

Add focused tests for the client contract:

```ts
it('returns null after every Xiaoai fetch retry fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
  await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toBeNull();
});

it('skips UBus records whose server timestamp is invalid', async () => {
  vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([
    nlpRecord('not-a-timestamp', 'bad'),
    nlpRecord('2000', 'good'),
  ]));
  await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5))
    .resolves.toEqual([expect.objectContaining({ timestamp_ms: 2_000 })]);
});
```

Use the complete real UBus response shape already consumed by `getLatestAskByUbus`; do not add test-only production methods.

- [ ] **Step 4: Run Mina client tests and capture RED**

Run: `npx vitest run tests/mina/conversation_answer.test.ts`

Expected: FAIL because exhausted retries return `[]` and invalid UBus timestamps become `0`.

- [ ] **Step 5: Implement server-timestamp priming**

Implement the following contracts without copying unrelated upstream debugging or feature work:

```ts
interface DeviceMonitorState {
  // existing fields
  lastTimestampMs: number;
  primed: boolean;
  isRunning: boolean;
}

export interface DeviceMonitorStatusItem {
  // existing fields
  last_timestamp_ms: number;
  primed: boolean;
}

// New devices:
lastTimestampMs: 0,
primed: false,

// First successful poll only:
if (!dm.primed) {
  dm.lastTimestampMs = askMessages.reduce(
    (max, message) => Math.max(max, message.timestamp_ms),
    0,
  );
  dm.primed = true;
  return;
}
```

In `start()`, after `refreshDevices()` and before `setInterval`, run one awaited `pollAll()` in its own `try/catch`; if `stop()` happens during priming, do not install the timer. A `null` poll result must leave the device unprimed. A successful `[]` result must prime it. The first successful batch must not enter the message buffer, callbacks, or webhooks.

In `MinaHTTPClient`, return `null` after all direct Xiaoai retries fail; make the UBus helper return `null` for transport/device/parse failures but `[]` for a valid empty response; skip and warn for non-finite or non-positive UBus timestamps.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run tests/conversation/monitor.test.ts tests/mina/conversation_answer.test.ts`

Expected: PASS with no warnings other than warnings intentionally captured/asserted by a test.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/conversation/monitor.ts src/mina/client.ts tests/conversation/monitor.test.ts tests/mina/conversation_answer.test.ts
git commit -m "fix: prime conversations from server timestamps"
```

---

### Task 2: Target Playlist Playback by Song ID

**Files:**
- Modify: `src/player/manager.ts`
- Modify: `src/handlers/playlist.ts`
- Modify: `static/js/speaker_modules/playlists.js`
- Test: `tests/player/playback_target_contract.test.ts`
- Test: `tests/handlers/playlist.test.ts`
- Test: `tests/ui/speaker_player.test.ts`

**Interfaces:**
- Consumes: fresh playlist data from `songloft.playlists.getSongs()` or Starlight's existing dynamic playlist loader.
- Produces: `PlaylistManager.playPlaylistFromSong(playlistId: number, songId: number, mode?: PlayMode, fallbackIndex?: number): Promise<boolean>`; `/player/play` accepts optional `song_id` and returns the resolved `current_index`.

- [ ] **Step 1: Write failing manager and route tests**

Add tests that prove behavior rather than only method dispatch:

```ts
it('selects the requested song id from the freshly loaded playlist order', async () => {
  songloft.playlists.getSongs = vi.fn(async () => [song(22), song(21), song(23)]);
  await expect(manager.playPlaylistFromSong(9, 21, 'order', 0)).resolves.toBe(true);
  expect(manager.getStatus()).toMatchObject({ playlist_id: 9, current_index: 1 });
  expect(minaService.playURL).toHaveBeenCalledWith(
    'acc-1', 'dev-1', expect.stringContaining('/songs/21/play'), expect.any(Object),
  );
});

it('falls back to the validated request index when song id is absent from the fresh list', async () => {
  songloft.playlists.getSongs = vi.fn(async () => [song(10), song(11), song(12)]);
  await manager.playPlaylistFromSong(9, 99, 'order', 2);
  expect(manager.getStatus().current_index).toBe(2);
});
```

For `/player/play`, send `{ playlist_id: 9, start_index: 0, song_id: 21 }`, assert the response contains `current_index` from `manager.getStatus()`, and assert that the ID-aware path is used. Preserve existing strict validation for `playlist_id`, `start_index`, and `play_mode`.

- [ ] **Step 2: Run backend tests and capture RED**

Run: `npx vitest run tests/player/playback_target_contract.test.ts tests/handlers/playlist.test.ts`

Expected: FAIL because `playPlaylistFromSong` and the `song_id` route contract do not exist.

- [ ] **Step 3: Write failing speaker UI tests**

Exercise both the main speaker list and song drawer using the existing DOM harness. Render song rows with IDs, click a song, and inspect the real request body:

```ts
expect(button.dataset.songId).toBe('21');
expect(post).toHaveBeenCalledWith('/miot/player/play', expect.objectContaining({
  playlist_id: 9,
  start_index: 0,
  song_id: 21,
}));
```

- [ ] **Step 4: Run UI tests and capture RED**

Run: `npx vitest run tests/ui/speaker_player.test.ts`

Expected: FAIL because rendered rows and play payloads currently carry only `start_index`.

- [ ] **Step 5: Implement ID-aware playlist playback**

Add the ID-aware manager entry point using the same state reset, loading, play, persistence, dynamic playlist, and response projection rules as `play()`. Resolve the starting index as:

```ts
let resolvedIndex = this.songs.findIndex(song => song.id === songId);
if (resolvedIndex < 0) {
  resolvedIndex = fallbackIndex !== undefined
    && fallbackIndex >= 0
    && fallbackIndex < this.songs.length
    ? fallbackIndex
    : 0;
}
```

In the handler, use the new method only when `Number(song_id) > 0`; otherwise retain `manager.play(...)`. Return:

```ts
data: {
  message: 'playlist started',
  playlist_id: playlistId,
  play_mode: mode,
  current_index: manager.getStatus().current_index,
  current_song: manager.getCurrentSongForResponse(),
}
```

In `playlists.js`, add `data-song-id` to both shared row variants and include the selected song's numeric `id` as `song_id` from both the drawer and main-list click paths. Do not port the old MIoT monolithic page or overwrite Starlight's state/refresh flow.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run tests/player/playback_target_contract.test.ts tests/handlers/playlist.test.ts tests/ui/speaker_player.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/player/manager.ts src/handlers/playlist.ts static/js/speaker_modules/playlists.js tests/player/playback_target_contract.test.ts tests/handlers/playlist.test.ts tests/ui/speaker_player.test.ts
git commit -m "fix: target playlist playback by song id"
```

---

### Task 3: Verify Pause and Fall Back to Stop

**Files:**
- Modify: `src/mina/client.ts`
- Modify: `src/service/service.ts`
- Modify: `src/player/manager.ts`
- Test: `tests/mina/playback_api.test.ts`
- Test: `tests/service/service.test.ts`
- Test: `tests/player/pause_resume.test.ts`

**Interfaces:**
- Consumes: `player_get_play_status` where `data.info` is a JSON string and status `1` means playing.
- Produces: `MinaHTTPClient.playerPauseVerified(deviceId): Promise<'paused' | 'stopped' | 'failed'>`, `MinaHTTPClient.readPlayStatus(deviceId): Promise<number>`, and the matching `MinaService.pausePlayVerified(accountId, deviceId)` wrapper.

- [ ] **Step 1: Write failing Mina client tests**

Use fake timers and spy on the existing UBus boundary:

```ts
it('returns paused when either delayed status read is no longer playing', async () => {
  mockOperation('pause', true);
  vi.spyOn(client, 'readPlayStatus').mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  const pending = client.playerPauseVerified('dev-1');
  await vi.advanceTimersByTimeAsync(1_400);
  await expect(pending).resolves.toBe('paused');
  expect(operationActions()).toEqual(['pause']);
});

it('stops when two delayed reads still report playing', async () => {
  vi.spyOn(client, 'readPlayStatus').mockResolvedValue(1);
  const pending = client.playerPauseVerified('dev-1');
  await vi.advanceTimersByTimeAsync(1_400);
  await expect(pending).resolves.toBe('stopped');
  expect(operationActions()).toEqual(['pause', 'stop']);
});
```

Also assert that play, pause, and stop all reject device-level non-zero `data.code`, and that `readPlayStatus` returns `-1` for missing/malformed info.

- [ ] **Step 2: Run Mina tests and capture RED**

Run: `npx vitest run tests/mina/playback_api.test.ts`

Expected: FAIL because the verified API/read helper is absent and play does not yet share the device-level result contract.

- [ ] **Step 3: Write failing service and manager tests**

Add service delegation/error tests and extend the real manager behavior tests:

```ts
it('marks a stop-escalated pause as quiet but not directly resumable', async () => {
  minaService.pausePlayVerified.mockResolvedValue('stopped');
  await manager.playStandalone([{ ...song }], 0, 'order');
  await expect(manager.pause()).resolves.toBe(true);
  expect(manager.getStatus().state).toBe('paused');
  await expect(manager.resumePlayback()).resolves.toBe(false);
  expect(minaService.resumePlay).not.toHaveBeenCalled();
});

it('returns false and preserves truthful failure when verified pause fails', async () => {
  minaService.pausePlayVerified.mockResolvedValue('failed');
  await manager.playStandalone([{ ...song }], 0, 'order');
  await expect(manager.pause()).resolves.toBe(false);
});
```

Keep the existing frozen-position assertions for an ordinary `'paused'` result.

- [ ] **Step 4: Run service/manager tests and capture RED**

Run: `npx vitest run tests/service/service.test.ts tests/player/pause_resume.test.ts`

Expected: FAIL because `pausePlayVerified` and hard-stop tracking do not exist.

- [ ] **Step 5: Implement verified pause without seek**

Use these exact constants and return contract:

```ts
const PLAY_STATUS_PLAYING = 1;
const PAUSE_VERIFY_ATTEMPTS = 2;
const PAUSE_VERIFY_DELAY_MS = 700;
type PauseVerificationResult = 'paused' | 'stopped' | 'failed';
```

Centralize play/pause/stop UBus calls in `playerOperation(deviceId, action)` and use `isDeviceResultOK`. `playerPauseVerified()` must send pause, wait 700 ms before each of at most two reads, return `'paused'` as soon as a read is not status `1`, and after two status-`1` reads send a direct stop operation. Return `'stopped'` if that stop succeeds; otherwise return `'paused'` when the initial pause command was accepted and `'failed'` when it was not. Keep `playerStop()`'s existing pause-then-stop compatibility sequence.

The service wrapper returns `'failed'` for missing clients or exceptions. In `PlaylistManager`, add `hardStopped = false`, preserve the existing paused elapsed-time calculation, call `pausePlayVerified`, set `hardStopped` only for `'stopped'`, and return `false` only for `'failed'`. Before sending resume, return `false` when `hardStopped` is set. Clear `hardStopped` only after a new URL is successfully accepted in `playCurrentOnce`; also clear it when preparing/loading wholly new playback state where needed to prevent stale flags.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run tests/mina/playback_api.test.ts tests/service/service.test.ts tests/player/pause_resume.test.ts tests/player/device_result_contract.test.ts tests/player/peek_and_pause_guard.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/mina/client.ts src/service/service.ts src/player/manager.ts tests/mina/playback_api.test.ts tests/service/service.test.ts tests/player/pause_resume.test.ts
git commit -m "fix: verify speaker pause before reporting success"
```

---

### Task 4: Add Independent Radio MP3 Transcoding Configuration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config/manager.ts`
- Modify: `src/handlers/config.ts`
- Modify: `src/player/manager.ts`
- Modify: `src/player/url_builder.ts`
- Modify: `static/index.html`
- Modify: `static/js/automation_modules/config.js`
- Test: `tests/config/manager.test.ts`
- Test: `tests/handlers/config.test.ts`
- Test: `tests/player/playback_target_contract.test.ts`
- Test: `tests/ui/settings_config.test.ts`
- Test: `tests/ui/static_layout.test.ts`

**Interfaces:**
- Consumes: host-supported `radio_transcode=mp3` query parameter and existing `PluginConfig` persistence.
- Produces: `PluginConfig.radio_force_mp3: boolean`; `URLBuilder.buildSongURL(..., { radioForceMp3?: boolean })`.

- [ ] **Step 1: Write failing configuration and UI tests**

Extend legacy-default, GET/POST route, form serialization/load, and static layout tests:

```ts
expect(config.radio_force_mp3).toBe(false);

await router.handle(request('POST', '/config', { radio_force_mp3: true }));
expect(configManager.saveConfig).toHaveBeenCalledWith(
  expect.objectContaining({ radio_force_mp3: true }),
);

expect(configFromForm({ elements: {
  force_mp3: { checked: false },
  radio_force_mp3: { checked: true },
} })).toEqual({ force_mp3: false, radio_force_mp3: true });

expect(indexHtml).toContain('name="radio_force_mp3" type="checkbox"');
```

- [ ] **Step 2: Run configuration/UI tests and capture RED**

Run: `npx vitest run tests/config/manager.test.ts tests/handlers/config.test.ts tests/ui/settings_config.test.ts tests/ui/static_layout.test.ts`

Expected: FAIL because the new key is absent from defaults, handlers, form bindings, and markup.

- [ ] **Step 3: Write failing URL behavior tests**

Test the actual URL passed through `PlaylistManager`/`URLBuilder`:

```ts
expect(await URLBuilder.buildSongURL(radioSong, { radioForceMp3: true }))
  .toBe('http://songloft.test:18191/api/v1/songs/7/play?access_token=tok&radio_transcode=mp3');
expect(await URLBuilder.buildSongURL(localSong, { radioForceMp3: true }))
  .not.toContain('radio_transcode');
expect(await URLBuilder.buildSongURL(radioSong, { forceMp3: true, radioForceMp3: false }))
  .toContain('&format=mp3');
```

Also assert that a manager with `{ radio_force_mp3: true }` passes a radio URL containing `radio_transcode=mp3` to `minaService.playURL`.

- [ ] **Step 4: Run player tests and capture RED**

Run: `npx vitest run tests/player/playback_target_contract.test.ts`

Expected: FAIL because `radioForceMp3` is not accepted or forwarded.

- [ ] **Step 5: Implement the independent setting**

Add the type/default/handler projections:

```ts
radio_force_mp3: boolean;

// defaultPluginConfig()
radio_force_mp3: false,

// GET /config
radio_force_mp3: !!config.radio_force_mp3,

// POST/PUT /config
if (body.radio_force_mp3 !== undefined) {
  config.radio_force_mp3 = !!body.radio_force_mp3;
}
```

Forward `radioForceMp3: !!config.radio_force_mp3` from `PlaylistManager` and extend `URLBuilder` as follows:

```ts
static async buildSongURL(
  song: { id?: number; url?: string; type?: string },
  options?: { forceMp3?: boolean; radioForceMp3?: boolean },
): Promise<string> {
  // existing relative URL/token logic
  if (options?.forceMp3) url += '&format=mp3';
  if (options?.radioForceMp3 && song.type === 'radio') {
    url += '&radio_transcode=mp3';
  }
  return url;
}
```

Add a separate `radio_force_mp3` checkbox beside `force_mp3` in the existing speaker settings form. Include the key in both field-name arrays in `automation_modules/config.js`; use the existing form save path and do not add a separate request or monolithic MIoT UI.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run tests/config/manager.test.ts tests/handlers/config.test.ts tests/player/playback_target_contract.test.ts tests/ui/settings_config.test.ts tests/ui/static_layout.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config/manager.ts src/handlers/config.ts src/player/manager.ts src/player/url_builder.ts static/index.html static/js/automation_modules/config.js tests/config/manager.test.ts tests/handlers/config.test.ts tests/player/playback_target_contract.test.ts tests/ui/settings_config.test.ts tests/ui/static_layout.test.ts
git commit -m "feat: add radio MP3 transcoding option"
```

---

## Final Verification

- [ ] Generate a whole-branch review package from `git merge-base origin/main HEAD` to `HEAD` and obtain an independent final review.
- [ ] Fix and re-review every Critical or Important finding; record Minor findings in `.superpowers/sdd/progress.md` for final triage.
- [ ] Run `npm run typecheck` and confirm exit 0.
- [ ] Run `npm test` and confirm every test file/test passes with 0 failures.
- [ ] Run `npm run build` and confirm exit 0.
- [ ] Run `npm run validate` and confirm exit 0.
- [ ] Confirm `git diff --check` has no whitespace errors and `git status --short` is clean after the final commit.
- [ ] Push with `git push -u origin codex/sync-miot-v2026-8-3`.
