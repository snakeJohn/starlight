import { $, $$, toast } from '../state.js';

const STORAGE_KEY = 'starlight.playbackTarget';

/** @typedef {'browser' | 'speaker'} PlaybackTarget */

/** @type {PlaybackTarget} */
let selectedTarget = loadTarget();

/** @type {PlaybackTarget | null} */
let activePlayingTarget = null;

let pendingTargetHint = false;

/** @type {Set<(next: PlaybackTarget, prev: PlaybackTarget) => void>} */
const changeListeners = new Set();

function loadTarget() {
    try {
        const raw = globalThis.localStorage?.getItem?.(STORAGE_KEY);
        if (raw === 'browser' || raw === 'speaker') return raw;
    } catch {
        // ignore
    }
    return 'speaker';
}

function persistTarget(target) {
    try {
        globalThis.localStorage?.setItem?.(STORAGE_KEY, target);
    } catch {
        // ignore
    }
}

export function getSelectedPlaybackTarget() {
    return selectedTarget;
}

export function getActivePlayingTarget() {
    return activePlayingTarget;
}

export function setActivePlayingTarget(target) {
    activePlayingTarget = target === 'browser' || target === 'speaker' ? target : null;
    syncPlaybackTargetUi();
}

export function targetLabel(target = selectedTarget) {
    return target === 'browser' ? '浏览器' : '智能音箱';
}

/**
 * Change selected target only — does not stop or migrate playback.
 * @param {PlaybackTarget} target
 * @param {{ silent?: boolean }} [options]
 */
export function onPlaybackTargetChange(listener) {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
}

export function setSelectedPlaybackTarget(target, options = {}) {
    if (target !== 'browser' && target !== 'speaker') return selectedTarget;
    if (target === selectedTarget) {
        syncPlaybackTargetUi();
        return selectedTarget;
    }
    const previous = selectedTarget;
    selectedTarget = target;
    persistTarget(target);
    pendingTargetHint = true;
    syncPlaybackTargetUi();
    for (const listener of changeListeners) {
        try {
            listener(target, previous);
        } catch {
            // ignore listener errors
        }
    }
    if (!options.silent) {
        toast(`已切换到${targetLabel(target)}，点播放后生效`);
    }
    return selectedTarget;
}

export function clearPendingTargetHint() {
    pendingTargetHint = false;
}

export function hasPendingTargetHint() {
    return pendingTargetHint;
}

export function syncPlaybackTargetUi() {
    $$('[data-role="playback-target-option"]').forEach(button => {
        const value = button.getAttribute?.('data-target') || button.dataset?.target;
        const active = value === selectedTarget;
        button.classList?.toggle?.('active', active);
        button.setAttribute?.('aria-pressed', String(active));
    });

    const hint = $('[data-role="playback-target-hint"]');
    if (hint) {
        if (pendingTargetHint) {
            hint.hidden = false;
            hint.textContent = `下次播放将使用${targetLabel(selectedTarget)}`;
        } else {
            hint.hidden = true;
            hint.textContent = '';
        }
    }

    // Only show status while something is actually playing on a target.
    // Selected target is already indicated by the segment buttons — avoid triple copy.
    const current = $('[data-role="playback-active-target"]');
    if (current) {
        if (activePlayingTarget) {
            current.hidden = false;
            current.textContent = `正在播放：${targetLabel(activePlayingTarget)}`;
        } else {
            current.hidden = true;
            current.textContent = '';
        }
        const meta = current.closest?.('.playback-target-meta') || current.parentElement;
        if (meta) meta.hidden = !activePlayingTarget;
    }

    document.body?.classList?.toggle?.('playback-target-browser', selectedTarget === 'browser');
    document.body?.classList?.toggle?.('playback-target-speaker', selectedTarget === 'speaker');
}

export function bindPlaybackTargetSelector() {
    syncPlaybackTargetUi();
    $$('[data-action="playback-target-select"]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault?.();
            const value = button.getAttribute?.('data-target') || button.dataset?.target;
            if (value === 'browser' || value === 'speaker') {
                setSelectedPlaybackTarget(value);
            }
        });
    });
}
