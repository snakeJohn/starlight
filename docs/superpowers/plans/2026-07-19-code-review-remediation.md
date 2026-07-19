# Code Review Remediation Plan

## Purpose

This is the actionable remediation plan for the whole-project review completed on 2026-07-19 against commit 481c989. It covers confirmed defects and risks only. Do not mix these tasks with unrelated feature work or broad refactors.

## Completion Gate

Each item needs focused regression coverage. The integration agent must run:

~~~powershell
npm run typecheck
npm test
npm audit --omit=dev --json
~~~

After the release reproducibility task is complete, also run:

~~~powershell
git diff --exit-code
npm run build
npm run validate
git diff --exit-code
~~~

The final diff must be empty. The current build is intentionally excluded from read-only review verification because its prebuild hook fetches remote data and rewrites tracked source files.

## Parallel Allocation

| Workstream | Items | Main files |
| --- | --- | --- |
| LX security | 1, 8 | src/lx_sync, tests/lx_sync |
| Credential protection | 2 | src/auth, src/config, src/handlers/account.ts |
| Music source consistency | 3 | src/music/source_manager.ts |
| Monitor and outbound HTTP | 4, 7 | src/conversation, src/voicecmd |
| Release engineering | 5, 6, 10 | workflow, scripts, package metadata |
| Scheduling | 9 | src/schedule, configuration |

Agents must not edit files outside their workstream without first coordinating with the integrating agent.

## 1. Prevent LX Authentication Brute-force Bypass

**Priority:** Important  
**Scope:** src/lx_sync/protocol_http.ts, auth_rate_limit.ts, crypto_lx.ts, tests/lx_sync

### Problem

peerKeyFromRequest() accepts X-Forwarded-For and X-Real-IP from every public /ah request. A direct client can rotate those headers to evade the eight-attempt block. The generated LX password has only six digits, so the bypass has real brute-force impact.

### Required Changes

- Use the transport peer address by default.
- Honor forwarded-address headers only when the host explicitly identifies a trusted reverse proxy. If the SDK cannot provide that information, ignore the forwarded headers.
- Generate a high-entropy LX secret that remains compatible with the LX client input field and current key derivation.
- Preserve the existing password-rotation behavior: device revocation, serverId rotation, socket closure, and cleared stale rate-limit entries.

### Acceptance

- Eight invalid requests from one transport peer are blocked even when each sends a different forwarded header.
- A supported trusted-proxy deployment can still use its forwarded client address.
- Existing key authentication, password rotation, and revoked-device behavior continue to pass.

## 2. Protect Persisted and Returned Credentials

**Priority:** Important  
**Scope:** src/auth/service.ts, src/config/manager.ts, src/handlers/account.ts, src/handlers/config.ts, src/types.ts, related tests

### Problem

Successful password login stores the raw password. Account endpoints say they mask sensitive fields but return pass_token through object spreading. Configuration reads return raw external-search tokens and AI API keys.

### Required Changes

- Store credentials in a Songloft secure-secret facility. If that does not exist, use host-provided authenticated encryption and document the local-threat model. Never use a key stored in this repository.
- Add an idempotent migration for existing account and configuration records.
- Replace response object spreading with explicit response DTOs.
- Return presence flags such as has_pass_token and has_api_key instead of secret values.
- Preserve a secret when an update omits it. Require an explicit replace or clear operation.
- Ensure errors, logs, and URL diagnostics redact credentials.

### Acceptance

- Account list and detail responses never contain a real password, pass_token, service_token, or ssecurity.
- Configuration reads never return API keys or external-search tokens.
- Existing saved credentials migrate once and remain usable.
- Updating another configuration field does not erase an existing secret.

## 3. Serialize Music Source Mutations

**Priority:** Important  
**Scope:** src/music/source_manager.ts, src/music/source_store.ts, tests/music/source_manager.test.ts

### Problem

Import, toggle, and delete operations all compute a replacement index from the same in-memory sources array. Concurrent requests can overwrite each other's save and leave orphaned scripts or unindexed sources.

### Required Changes

- Add one async mutation queue or a store transaction that covers the full read-modify-write sequence.
- Route importFromJS, importManyFromJS, setEnabled, and deleteSource through that boundary.
- Keep script/index rollback behavior when either persistence step fails.

### Acceptance

- Parallel imports retain every source in the final index.
- Parallel toggle/delete activity leaves the index and scripts consistent.
- A persistence failure retains the prior valid index.

## 4. Bound Conversation Monitor Webhooks

**Priority:** Important  
**Scope:** src/conversation/monitor.ts, tests/conversation/monitor.test.ts

### Problem

Device polling is sequential. Webhooks are also sent sequentially and await fetch without a timeout. One non-responsive webhook blocks later webhooks and devices; repeated interval ticks can build up stuck polling work.

### Required Changes

- Add a bounded webhook timeout and abort delivery where AbortController is available.
- Deliver independent webhooks with Promise.allSettled and record failures without blocking other recipients.
- Ensure pollAll cannot overlap itself while a previous cycle is active.
- Maintain in-order handling for messages from one device.

### Acceptance

- A permanently pending webhook times out and does not block a second device.
- One failed webhook does not prevent a healthy recipient from receiving its payload.
- Repeated timer ticks cannot create concurrent poll cycles.

## 5. Make Release Artifacts Reproducible

**Priority:** Important  
**Scope:** package.json, scripts/fetch-holidays.mjs, .github/workflows/release.yml, release tests

### Problem

The prebuild hook downloads holiday data from mutable master URLs and overwrites tracked source files. The release workflow builds that altered tree but commits only package metadata, so a published ZIP can differ from target_commitish.

### Required Changes

- Make holiday refresh an explicit reviewed update command, not a build hook.
- Pin the upstream source to an immutable tag or commit and record that revision with generated data.
- Make build deterministic and fail when it modifies tracked source files.
- Build releases from the exact commit recorded as target_commitish.

### Acceptance

- Repeated builds of one commit leave no tracked-source diff.
- Holiday data changes only through the explicit refresh command.
- Release tests fail when generated data is stale, malformed, or omitted from the release commit.

## 6. Apply Least Privilege to GitHub Actions

**Priority:** Important  
**Scope:** .github/workflows/release.yml

### Problem

The workflow executes every pushed branch with contents: write. A branch can change package scripts and execute them with repository-write authority even though release steps are main-only.

### Required Changes

- Split validation and release into separate jobs.
- Give validation contents: read only.
- Gate the release job on the main ref and grant contents: write there only.
- Pin actions in the privileged job to reviewed commit SHAs.
- Keep metadata commits from recursively publishing duplicate releases.

### Acceptance

- Non-main branches run validation without a write-capable token.
- Only main can commit release metadata, upload release artifacts, or create releases.

## 7. Cancel Timed-out External Requests

**Priority:** Minor  
**Scope:** src/voicecmd/ai_analyzer.ts, src/voicecmd/online_searcher.ts, tests

### Problem

Both modules race fetch against a timer. A timeout returns control to the caller but leaves the network request running. The online-search timer also remains scheduled after a successful request.

### Required Changes

- Centralize timeout-aware fetch behavior.
- Use AbortController where available. Otherwise bound in-flight work and clear timers in finally.
- Redact response snippets before logging them.

### Acceptance

- A timed-out request receives an abort signal.
- A successful request clears its timer.
- Repeated timeouts do not create unbounded in-flight requests.

## 8. Add LX WebSocket Resource Limits

**Priority:** Minor  
**Scope:** src/lx_sync/protocol_ws.ts, src/lx_sync/crypto_lx.ts, tests/lx_sync/protocol_ws.test.ts

### Problem

The server accepts arbitrary frame sizes, starts asynchronous decoding for every frame, and unconditionally inflates cg_ gzip payloads. A client with valid LX credentials can exhaust memory or CPU.

### Required Changes

- Define compressed-frame, inflated-payload, and per-connection in-flight-message limits.
- Reject oversized or malformed frames before JSON parsing and close abusive sockets.
- Serialize or otherwise bound decoding per socket.

### Acceptance

- Oversized plain and gzip frames are rejected without full inflation.
- Frame floods remain below the configured work limit.
- Normal LX list synchronization stays compatible.

## 9. Honor or Remove the Timezone Configuration

**Priority:** Minor  
**Scope:** src/schedule/scheduler.ts, src/config/manager.ts, src/handlers/config.ts, schedule tests

### Problem

The API persists timezone, but the scheduler uses the host-local Date getters only. The saved configuration cannot change when a task runs.

### Required Changes

Choose one explicit contract:

1. Recommended: derive task date, time, weekday, and holiday lookup using the configured IANA timezone.
2. Alternative: remove the unused setting and document scheduling as host-local time.

The first option preserves the existing configuration contract.

### Acceptance

- A task triggers at the correct instant when host and configured timezones differ.
- Weekly, monthly, and holiday-aware schedules use the same timezone basis.

## 10. Upgrade the Vulnerable Development Dependency

**Priority:** Low  
**Scope:** package.json, package-lock.json

### Problem

Full npm audit reports low-severity esbuild 0.27.7 through the Vitest/Vite development chain on Windows. Production-only audit is clean.

### Required Changes

- Upgrade Vitest/Vite to a compatible release that resolves esbuild to 0.28.1 or newer, or use a narrowly scoped tested override.
- Do not upgrade unrelated runtime dependencies for this development-only advisory.

### Acceptance

- Full npm audit reports zero vulnerabilities.
- Typecheck and the full test suite continue to pass.

