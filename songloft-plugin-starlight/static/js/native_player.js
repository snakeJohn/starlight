function safeHostWindow() {
    try {
        return window.parent || window;
    } catch {
        return window;
    }
}

function callDirectHook(host, songs, startIndex) {
    const hooks = [
        host?.SongloftPlayer,
        host?.songloftPlayer,
        window?.SongloftPlayer,
        window?.songloftPlayer,
    ].filter(Boolean);

    for (const hook of hooks) {
        for (const method of ['playSongs', 'playQueue', 'play']) {
            if (typeof hook?.[method] !== 'function') continue;
            try {
                hook[method](songs, startIndex);
                return true;
            } catch {
                // Try the next known host hook.
            }
        }
    }

    return false;
}

function callDirectControlHook(host, action, payload = {}) {
    const hooks = [
        host?.SongloftPlayer,
        host?.songloftPlayer,
        window?.SongloftPlayer,
        window?.songloftPlayer,
    ].filter(Boolean);
    const methodNames = {
        previous: ['previous', 'prev'],
        next: ['next'],
        pause: ['pause'],
        resume: ['resume', 'play'],
        stop: ['stop'],
        mode: ['setMode', 'mode'],
    }[action] || [action];

    for (const hook of hooks) {
        for (const method of methodNames) {
            if (typeof hook?.[method] !== 'function') continue;
            try {
                hook[method](payload);
                return true;
            } catch {
                // Try the next known host hook.
            }
        }
    }

    return false;
}

export function requestNativePlayback(songs, startIndex = 0) {
    const playableSongs = Array.isArray(songs) ? songs : [];
    const message = {
        type: 'songloft:native-player:play',
        songs: playableSongs,
        startIndex,
    };
    const host = safeHostWindow();
    const direct = callDirectHook(host, playableSongs, startIndex);

    try {
        host?.postMessage?.(message, '*');
    } catch {
        // Some native WebView hosts expose no postMessage surface.
    }

    return { requested: true, direct, message };
}

export function requestNativeControl(action, payload = {}) {
    const command = String(action || '').trim();
    if (!command) return { requested: false, direct: false, message: null };
    const message = {
        type: 'songloft:native-player:control',
        action: command,
        ...payload,
    };
    const host = safeHostWindow();
    const direct = callDirectControlHook(host, command, payload);

    try {
        host?.postMessage?.(message, '*');
    } catch {
        // Some native WebView hosts expose no postMessage surface.
    }

    return { requested: true, direct, message };
}
