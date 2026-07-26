export function getAuthToken() {
    return String(globalThis.window?.SongloftPlugin?.getAuthToken?.() || '').trim();
}

function pageOrigin() {
    try {
        return String(globalThis.window?.location?.origin || '').trim();
    } catch {
        return '';
    }
}

const SONGLOFT_SONG_MEDIA_PATH = /^\/api\/v1\/songs\/[^/]+\/(play|cover|lyric|lyrics)\/?$/i;

/**
 * Same-origin Songloft song media paths (play/cover/lyrics) may receive the host access token.
 * Absolute URLs to other origins must never receive the token.
 */
function isTrustedSongloftSongMediaResource(value) {
    try {
        const raw = String(value || '').trim();
        if (!raw) return false;

        // Relative path: always treated as current host.
        if (raw.startsWith('/') && !raw.startsWith('//')) {
            return SONGLOFT_SONG_MEDIA_PATH.test(raw.split(/[?#]/, 1)[0]);
        }

        const base = pageOrigin() || 'http://starlight.local';
        const url = new URL(raw, base);
        if (!SONGLOFT_SONG_MEDIA_PATH.test(url.pathname)) {
            return false;
        }

        const origin = pageOrigin();
        if (!origin) {
            return false;
        }
        return url.origin === origin;
    } catch {
        return false;
    }
}

/** @deprecated name kept for existing cover callers — now covers play/cover/lyrics */
function isTrustedSongloftSongCoverResource(value) {
    return isTrustedSongloftSongMediaResource(value);
}

export function authenticateSongloftResourceUrl(value) {
    const url = String(value || '').trim();
    if (!url || !isTrustedSongloftSongMediaResource(url) || /[?&]access_token=/.test(url)) return url;

    const token = getAuthToken();
    if (!token) return url;

    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}access_token=${encodeURIComponent(token)}${hash}`;
}

// Re-export helper used by older tests that probe cover-only trust.
export { isTrustedSongloftSongCoverResource };
