import { $, escapeHtml, toast } from '../state.js';

export const pageSizes = {
    search: 20,
    songlist: 20,
    songlistDetail: 20,
    ranking: 20,
    customPlaylistDetail: 20,
};

export function musicPageSize(scope) {
    return pageSizes[scope] || 20;
}

export function clampPage(page, totalPages) {
    const value = Number(page);
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(1, Math.floor(value)), Math.max(1, totalPages));
}

export function pageCount(total, pageSize) {
    return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / Math.max(1, Number(pageSize) || 1)));
}

export function renderPagination({ scope, page, total, pageSize }) {
    const totalPages = pageCount(total, pageSize);
    const currentPage = clampPage(page, totalPages);
    const escapedScope = escapeHtml(scope);
    return `
        <nav class="pagination-bar" data-pagination="${escapedScope}" data-page="${currentPage}" data-total-pages="${totalPages}">
            <button type="button" data-page-action="prev"${currentPage <= 1 ? ' disabled' : ''}>上一页</button>
            <span>第 ${currentPage} / ${totalPages} 页</span>
            <button type="button" data-page-action="next"${currentPage >= totalPages ? ' disabled' : ''}>下一页</button>
            <label>
                <span>指定页</span>
                <input data-role="${escapedScope}-page-input" type="number" min="1" max="${totalPages}" value="${currentPage}">
            </label>
            <button type="button" data-page-action="jump">跳转</button>
        </nav>
    `;
}

export function renderPaginationInto(role, options) {
    const node = $(`[data-role="${role}"]`);
    if (!node) return;
    node.innerHTML = renderPagination(options);
}

export function clearPagination(role) {
    const node = $(`[data-role="${role}"]`);
    if (node) node.innerHTML = '';
}

export function pageFromPagination(root, action) {
    const current = Number(root.dataset.page || 1);
    const totalPages = Number(root.dataset.totalPages || 1);
    if (action === 'prev') return clampPage(current - 1, totalPages);
    if (action === 'next') return clampPage(current + 1, totalPages);
    const input = root.querySelector(`[data-role="${root.dataset.pagination}-page-input"]`);
    return clampPage(input?.value || current, totalPages);
}

export function bindPagination(role, loadPage) {
    const host = $(`[data-role="${role}"]`);
    if (!host) return;
    host.addEventListener('click', async event => {
        const button = event.target.closest('[data-page-action]');
        if (!button || button.disabled) return;
        const root = button.closest('[data-pagination]');
        if (!root) return;
        button.disabled = true;
        try {
            await loadPage(pageFromPagination(root, button.dataset.pageAction));
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
    host.addEventListener('keydown', async event => {
        if (event.key !== 'Enter' || !event.target.matches('input[data-role$="-page-input"]')) return;
        event.preventDefault();
        const root = event.target.closest('[data-pagination]');
        if (!root) return;
        try {
            await loadPage(pageFromPagination(root, 'jump'));
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}
