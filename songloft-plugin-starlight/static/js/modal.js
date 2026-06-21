/**
 * Dialog 弹窗模块
 * 使用 Material Design 3 风格的 Dialog 组件
 */

/** Dialog 确认回调 */
let dialogResolve = null;

/**
 * 显示确认对话框
 * @param {string} title - 对话框标题
 * @param {string} content - 对话框内容
 * @param {string} confirmText - 确认按钮文本
 * @param {string} cancelText - 取消按钮文本
 * @returns {Promise<boolean>} 用户选择结果
 */
export function showDialog(title, content, confirmText = '确定', cancelText = '取消') {
    return new Promise((resolve) => {
        dialogResolve = resolve;

        const dialogTitle = document.getElementById('dialogTitle');
        const dialogContent = document.getElementById('dialogContent');
        const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');
        const dialogCancelBtn = document.getElementById('dialogCancelBtn');
        const dialogOverlay = document.getElementById('dialogOverlay');

        if (dialogTitle) dialogTitle.textContent = title;
        if (dialogContent) dialogContent.textContent = content;
        if (dialogConfirmBtn) dialogConfirmBtn.textContent = confirmText;
        if (dialogCancelBtn) dialogCancelBtn.textContent = cancelText;
        if (dialogOverlay) dialogOverlay.classList.add('show');
    });
}

/**
 * 关闭对话框
 * @param {boolean} result - 关闭结果（确认/取消）
 */
function closeDialog(result) {
    const dialogOverlay = document.getElementById('dialogOverlay');
    if (dialogOverlay) {
        dialogOverlay.classList.remove('show');
    }
    if (dialogResolve) {
        dialogResolve(result);
        dialogResolve = null;
    }
}

/**
 * 初始化对话框事件监听
 * 在 DOMContentLoaded 时调用
 */
export function initDialogs() {
    const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');
    const dialogCancelBtn = document.getElementById('dialogCancelBtn');
    const dialogOverlay = document.getElementById('dialogOverlay');

    if (dialogConfirmBtn) {
        dialogConfirmBtn.addEventListener('click', () => {
            closeDialog(true);
        });
    }

    if (dialogCancelBtn) {
        dialogCancelBtn.addEventListener('click', () => {
            closeDialog(false);
        });
    }

    // 点击遮罩层关闭对话框
    if (dialogOverlay) {
        dialogOverlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                closeDialog(false);
            }
        });
    }
}
