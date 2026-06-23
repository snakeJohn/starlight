export function getAuthToken() {
    return String(globalThis.window?.SongloftPlugin?.getAuthToken?.() || '').trim();
}

function isSongloftSongCoverResource(value) {
    try {
        const url = new URL(value, 'http://starlight.local');
        return /^\/api\/v1\/songs\/[^/]+\/cover\/?$/i.test(url.pathname);
    } catch {
        return false;
    }
}

export function authenticateSongloftResourceUrl(value) {
    const url = String(value || '').trim();
    if (!url || !isSongloftSongCoverResource(url) || /[?&]access_token=/.test(url)) return url;

    const token = getAuthToken();
    if (!token) return url;

    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const separator = beforeHash.includes('?') ? '&' : '?';
    return `${beforeHash}${separator}access_token=${encodeURIComponent(token)}${hash}`;
}
