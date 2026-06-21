export const tabs = [
    { id: 'search', label: '搜索', icon: 'S' },
    { id: 'speaker', label: '音箱', icon: 'M' },
    { id: 'songlists', label: '歌单', icon: 'L' },
    { id: 'rankings', label: '排行', icon: '#' },
    { id: 'sources', label: '音源', icon: '+' },
    { id: 'automation', label: '自动化', icon: 'A' },
    { id: 'settings', label: '设置', icon: 'C' },
];

export const state = {
    activeTab: 'search',
    accountId: '',
    deviceId: '',
    platform: 'kw',
    quality: '320k',
    searchResults: [],
    platforms: [],
    sources: [],
    accounts: [],
    deviceGroups: [],
    selectedSong: null,
    message: '就绪',
};

export function setState(patch) {
    Object.assign(state, patch);
    window.dispatchEvent(new CustomEvent('starlight:state', { detail: patch }));
}

export function $(selector, root = document) {
    return root.querySelector(selector);
}

export function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function durationLabel(seconds) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return '--:--';
    const minutes = Math.floor(total / 60);
    const rest = Math.floor(total % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function toast(message, type = 'success') {
    const existing = $('.toast');
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 3600);
}

export function setBusy(element, busy, label = '处理中') {
    if (!element) return;
    if (busy) {
        element.dataset.originalText = element.textContent;
        element.textContent = label;
        element.disabled = true;
    } else {
        element.textContent = element.dataset.originalText || element.textContent;
        element.disabled = false;
    }
}

export function selectedDevicePayload() {
    return {
        account_id: state.accountId,
        device_id: state.deviceId,
    };
}
