/**
 * Bind select-all / clear / batch action buttons for checkbox song lists.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.root - batch actions container selector or element
 * @param {string|HTMLElement} options.list - list container selector or element
 * @param {string} options.checkboxRole - data-role of checkboxes
 * @param {Record<string, string>} options.actions - map of data-action → handler key
 *   reserved keys: selectAll, clear
 * @param {(list: HTMLElement, role: string) => any[]} options.getSelected
 * @param {Record<string, (songs: any[], button: HTMLElement) => Promise<void>|void>} options.handlers
 * @param {(message: string, type?: string) => void} options.toast
 * @param {(selector: string, root?: ParentNode) => HTMLElement|null} options.$
 * @param {(selector: string, root?: ParentNode) => HTMLElement[]} options.$$
 */
export function bindSelectableBatchActions(options) {
    const {
        root,
        list,
        checkboxRole,
        actions,
        getSelected,
        handlers,
        toast,
        $,
        $$,
    } = options;

    const rootEl = typeof root === 'string' ? $(root) : root;
    const listEl = typeof list === 'string' ? $(list) : list;
    if (!rootEl || !listEl) return;

    rootEl.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const checks = $$(`[data-role="${checkboxRole}"]`, listEl);

        if (action === actions.selectAll) {
            checks.forEach(input => { input.checked = true; });
            return;
        }
        if (action === actions.clear) {
            checks.forEach(input => { input.checked = false; });
            return;
        }

        const handlerKey = actions[action];
        if (!handlerKey || typeof handlers[handlerKey] !== 'function') return;

        button.disabled = true;
        try {
            const selected = getSelected(listEl, checkboxRole);
            if (!selected.length) throw new Error('请先选择歌曲');
            await handlers[handlerKey](selected, button);
        } catch (error) {
            toast(error.message || String(error), 'error');
        } finally {
            button.disabled = false;
        }
    });
}
