export const tabs = [
    { id: 'search', label: '搜索', icon: 'S' },
    { id: 'speaker', label: '音箱', icon: 'M' },
    { id: 'songlists', label: '歌单', icon: 'L' },
    { id: 'rankings', label: '排行', icon: '#' },
    { id: 'sources', label: '音源', icon: '+' },
    { id: 'download', label: '下载', icon: 'D' },
    { id: 'automation', label: '自动化', icon: 'A' },
];

export const state = {
    activeTab: 'search',
    accountId: '',
    deviceId: '',
    deviceName: '',
    speakerPlayerState: 'idle',
    platform: 'kw',
    quality: '320k',
    searchQuery: null,
    searchResults: [],
    searchPage: 1,
    searchTotal: 0,
    songlistQuery: null,
    songlistDetailContext: null,
    songlists: [],
    songlistSongs: [],
    songlistPage: 1,
    songlistTotal: 0,
    songlistDetailPage: 1,
    songlistDetailTotal: 0,
    songloftSongs: [],
    songloftLocalSongs: [],
    songloftPlaylists: [],
    songloftPlaylistSongs: [],
    songloftPlaylistTitle: '歌单歌曲',
    rankingBoards: [],
    rankingContext: null,
    rankingSongs: [],
    rankingPage: 1,
    rankingTotal: 0,
    customPlaylists: [],
    customPlaylistId: '',
    customPlaylistDetailId: '',
    customPlaylistDetailPage: 1,
    platforms: [],
    sources: [],
    downloadSources: [],
    downloadSettings: null,
    downloadProgress: null,
    accounts: [],
    deviceGroups: [],
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
