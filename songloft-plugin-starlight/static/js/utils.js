/**
 * 通用工具函数模块
 * 提供 Snackbar 提示、加载状态、控制状态管理、时间格式化等工具
 */

/** Snackbar 定时器 */
let snackbarTimer = null;

/**
 * 显示 Snackbar 提示（Material Design 3 风格）
 * @param {string} message - 提示消息
 * @param {string} type - 类型：success / error / info
 * @param {number} duration - 显示时长（毫秒），默认 3000
 */
export function showSnackbar(message, type = 'info', duration = 3000) {
    const el = document.getElementById('snackbar');
    if (!el) return;

    if (snackbarTimer) clearTimeout(snackbarTimer);

    el.textContent = message;
    el.className = `snackbar ${type} show`;

    snackbarTimer = setTimeout(() => {
        el.className = 'snackbar';
    }, duration);
}

/**
 * 显示加载状态（禁用按钮、设置等待光标）
 * @param {HTMLElement} element - 可选，指定元素添加加载状态
 * @param {string} text - 可选，加载提示文字
 */
export function showLoading(element, text) {
    document.body.style.cursor = 'wait';

    // 禁用所有按钮和选择框
    const buttons = document.querySelectorAll('.btn-filled, .btn-outlined, .btn-text, .btn-icon');
    buttons.forEach(button => {
        if (button.id !== 'accountSelect' && button.id !== 'deviceSelect') {
            button.disabled = true;
        }
    });

    // 如果指定了元素，添加加载状态
    if (element) {
        const originalContent = element.innerHTML;
        element.dataset.originalContent = originalContent;
        element.innerHTML = `<span class="spinner"></span>${text || '加载中...'}`;
        element.disabled = true;
    }
}

/**
 * 隐藏加载状态（恢复按钮、恢复光标）
 * @param {HTMLElement} element - 可选，指定元素恢复原状
 */
export function hideLoading(element) {
    document.body.style.cursor = 'default';

    // 恢复所有按钮
    const buttons = document.querySelectorAll('.btn-filled, .btn-outlined, .btn-text, .btn-icon');
    buttons.forEach(button => {
        if (button.id !== 'accountSelect' && button.id !== 'deviceSelect') {
            button.disabled = false;
        }
    });

    // 恢复指定元素的原始内容
    if (element && element.dataset.originalContent) {
        element.innerHTML = element.dataset.originalContent;
        element.disabled = false;
        delete element.dataset.originalContent;
    }

    updateControlState();
}

/**
 * 更新播放控制和 URL 播放区域的启用状态
 * 根据是否选中设备来启用/禁用控件
 */
export function updateControlState() {
    // 从全局变量或 localStorage 获取当前设备状态
    const hasDevice = !!window.currentDeviceId;

    // 播放控制区域的按钮
    const playbackButtons = ['playBtn', 'prevBtn', 'nextBtn', 'playModeBtn', 'muteBtn'];
    playbackButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !hasDevice;
    });

    // 音量滑块
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) volumeSlider.disabled = !hasDevice;

    // 歌单选择
    const playlistSelect = document.getElementById('playlistSelect');
    if (playlistSelect) playlistSelect.disabled = !hasDevice;

    // URL 播放区域
    const playUrlInput = document.getElementById('playUrlInput');
    const playUrlBtn = document.getElementById('playUrlBtn');
    if (playUrlInput) playUrlInput.disabled = !hasDevice;
    if (playUrlBtn) playUrlBtn.disabled = !hasDevice;
}

/**
 * 显示操作结果到结果面板
 * @param {Object} data - 要显示的数据对象
 */
export function showResult(data) {
    const resultContent = document.getElementById('resultContent');
    if (resultContent) {
        resultContent.textContent = JSON.stringify(data, null, 2);
    }
}

/**
 * 清空操作结果面板
 */
export function clearResult() {
    const resultContent = document.getElementById('resultContent');
    if (resultContent) {
        resultContent.textContent = '暂无操作结果';
    }
    showSnackbar('已清空操作结果', 'info');
}

/**
 * 获取当前选中的账号 ID
 * 优先从全局变量获取，否则从选择框获取
 * @returns {string|null} 账号 ID，未选中时返回 null 并提示
 */
export function getAccountId() {
    // 优先使用全局变量（设备确认后设置）
    if (window.currentAccountId) {
        return window.currentAccountId;
    }
    // 备用：从设备管理 Tab 的选择框获取
    const accountSelect = document.getElementById('accountSelect');
    const accountId = accountSelect ? accountSelect.value : '';
    if (!accountId) {
        showSnackbar('请先选择设备', 'error');
        return null;
    }
    return accountId;
}

/**
 * 获取当前选中的设备 ID
 * 优先从全局变量获取，否则从选择框获取
 * @returns {string|null} 设备 ID，未选中时返回 null 并提示
 */
export function getDeviceId() {
    // 优先使用全局变量（设备确认后设置）
    if (window.currentDeviceId) {
        return window.currentDeviceId;
    }
    // 备用：从设备管理 Tab 的选择框获取
    const deviceSelect = document.getElementById('deviceSelect');
    const deviceId = deviceSelect ? deviceSelect.value : '';
    if (!deviceId) {
        showSnackbar('请先选择设备', 'error');
        return null;
    }
    return deviceId;
}

/**
 * 格式化时长显示（秒 -> 分:秒）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时长字符串
 */
export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return minutes + ':' + (secs < 10 ? '0' : '') + secs;
}

/**
 * HTML 转义函数
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
