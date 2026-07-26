/** Max failed /ah attempts per peer before temporary block. */
export const AUTH_MAX_FAILURES = 8;
/** Block duration after threshold (ms). */
export const AUTH_BLOCK_MS = 10 * 60 * 1000;
/** Failure counter idle reset (ms). */
export const AUTH_WINDOW_MS = 15 * 60 * 1000;

type AuthPeerState = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
};

/** Hard cap on tracked peers; stale entries are pruned before it is reached. */
const AUTH_MAX_PEERS = 1024;

const authPeers = new Map<string, AuthPeerState>();

/** Entry is no longer meaningful: not blocked and its failure window has elapsed. */
function isStale(state: AuthPeerState, now: number): boolean {
  if (state.blockedUntil > now) return false;
  if (state.blockedUntil) return true;
  return !state.firstFailureAt || now - state.firstFailureAt > AUTH_WINDOW_MS;
}

function pruneAuthPeers(now: number): void {
  for (const [peer, state] of authPeers) {
    if (isStale(state, now)) authPeers.delete(peer);
  }
}

export function getPeerState(peer: string): AuthPeerState {
  let state = authPeers.get(peer);
  if (!state) {
    state = { failures: 0, firstFailureAt: 0, blockedUntil: 0 };
    authPeers.set(peer, state);
  }
  return state;
}

export function isPeerBlocked(peer: string, now = Date.now()): boolean {
  // Read-only lookup: every /ah hit calls this, so it must not create a permanent entry.
  const state = authPeers.get(peer);
  if (!state) return false;
  if (state.blockedUntil > now) return true;
  if (isStale(state, now)) authPeers.delete(peer);
  return false;
}

export function recordAuthFailure(peer: string, now = Date.now()): void {
  if (!authPeers.has(peer) && authPeers.size >= AUTH_MAX_PEERS) pruneAuthPeers(now);
  const state = getPeerState(peer);
  if (state.blockedUntil > now) return;
  if (!state.firstFailureAt || now - state.firstFailureAt > AUTH_WINDOW_MS) {
    state.failures = 0;
    state.firstFailureAt = now;
  }
  state.failures += 1;
  if (state.failures >= AUTH_MAX_FAILURES) {
    state.blockedUntil = now + AUTH_BLOCK_MS;
    songloft.log.warn(`[LxSync] /ah blocked peer=${peer} for ${AUTH_BLOCK_MS / 1000}s`);
  }
}

export function recordAuthSuccess(peer: string): void {
  authPeers.delete(peer);
}

/** Tracked peer count (diagnostics / tests). */
export function getAuthPeerCount(): number {
  return authPeers.size;
}

/** Clear /ah rate-limit state (password rotate, tests). */
export function clearAuthRateLimits(): void {
  authPeers.clear();
}

/** @deprecated Use clearAuthRateLimits — kept for existing tests. */
export function resetAuthRateLimitForTests(): void {
  clearAuthRateLimits();
}
