const BASE = 'api';

function getAuthToken() {
    return globalThis.window?.SongloftPlugin?.getAuthToken?.() || '';
}

function hasAuthorization(headers) {
    return Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
}

function requestHeaders(headers = {}) {
    const nextHeaders = {
        'Content-Type': 'application/json',
        ...headers,
    };
    const token = getAuthToken();

    if (token && !hasAuthorization(nextHeaders)) {
        nextHeaders.Authorization = `Bearer ${token}`;
    }

    return nextHeaders;
}

function messageFrom(error) {
    if (!error) return '请求失败';
    if (typeof error === 'string') return error;
    return error.message || error.code || '请求失败';
}

async function request(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
        ...options,
        headers: requestHeaders(options.headers || {}),
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok || !payload.success) {
        const error = new Error(messageFrom(payload.error) || response.statusText || '请求失败');
        error.code = payload.error?.code || response.status;
        error.retryable = payload.error?.retryable;
        throw error;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data;
    }

    const { success, error, ...legacyData } = payload;
    return legacyData;
}

export const api = {
    get: path => request(path),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
    delete: path => request(path, { method: 'DELETE' }),
};
