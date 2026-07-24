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

/**
 * Only attach host access tokens to same-origin Songloft cover paths.
 * Absolute URLs to other origins (even if path looks like /api/v1/songs/.../cover)
 * must never receive the token.
 */
function isTrustedSongloftSongCoverResource(value) {
    try {
        const raw = String(value || '').trim();
        if (!raw) return false;

        // Relative path: always treated as current host.
        if (raw.startsWith('/') && !raw.startsWith('//')) {
            return /^\/api\/v1\/songs\/[^/]+\/cover\/?$/i.test(raw.split(/[?#]/, 1)[0]);
        }

        const base = pageOrigin() || 'http://starlight.local';
        const url = new URL(raw, base);
        if (!/^\/api\/v1\/songs\/[^/]+\/cover\/?$/i.test(url.pathname)) {
            return false;
        }

        // Absolute URL: only same origin as the plugin page may receive the token.
        const origin = pageOrigin();
        if (!origin) {
            // No page context (tests / non-browser): only allow relative forms above.
            return false;
        }
        return url.origin === origin;
    } catch {
        return false;
    }
}

export function authenticateSongloftResourceUrl(value) {
    const url = String(value || '').trim();
    if (!url || !isTrustedSongloftSongCoverResource(url) || /[?&]access_token=/.test(url)) return url;

    const token = getAuthToken();
    if (!token) return url;

    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}access_token=${encodeURIComponent(token)}${hash}`;
}
