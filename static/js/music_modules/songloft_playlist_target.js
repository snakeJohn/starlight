import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import {
    fetchSongloftPlaylists,
    songloftPlaylistId as playlistId,
    songloftPlaylistName as playlistName,
} from '../shared/songloft_playlists.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';

const IMPORT_JOB_POLL_INTERVAL_MS = 1500;
/** Absolute ceiling — large Kuwo lists (300+) can take 15–40+ minutes. */
const IMPORT_JOB_MAX_TOTAL_MS = 60 * 60 * 1000;
/** Abort only when the job stops reporting progress for this long. */
const IMPORT_JOB_MAX_IDLE_MS = 8 * 60 * 1000;
/** Safety poll cap (1 hour / 1.5s). */
const IMPORT_JOB_MAX_POLLS = 2400;

function targetNodes() {
    return {
        dialog: $('[data-role="songloft-playlist-target-dialog"]'),
        form: $('[data-role="songloft-playlist-target-form"]'),
        select: $('[data-role="songloft-target-playlist-select"]'),
        filter: $('[data-role="songloft-target-playlist-filter"]'),
        name: $('[data-role="songloft-target-playlist-name"]'),
        count: $('[data-role="songloft-target-song-count"]'),
        refresh: $('[data-action="refresh-songloft-target-playlists"]'),
        cancel: $('[data-action="cancel-songloft-target"]'),
        confirm: $('[data-action="confirm-songloft-target"]'),
    };
}

function selectedTargetPlaylist() {
    return asArray(state.songloftTargetPlaylists)
        .find(playlist => playlistId(playlist) === state.songloftTargetPlaylistId);
}

function renderTargetPlaylists(filterText = '') {
    const { select } = targetNodes();
    if (!select) return;
    const needle = String(filterText || '').trim().toLowerCase();
    const playlists = asArray(state.songloftTargetPlaylists)
        .filter(playlist => {
            if (!needle) return true;
            return playlistName(playlist).toLowerCase().includes(needle);
        });
    select.innerHTML = playlists.length
        ? playlists.map(playlist => `<option value="${escapeHtml(playlistId(playlist))}">${escapeHtml(playlistName(playlist))}</option>`).join('')
        : '<option value="">暂无 Songloft 歌单</option>';

    const currentId = state.songloftTargetPlaylistId;
    const nextId = playlists.some(playlist => playlistId(playlist) === currentId)
        ? currentId
        : playlistId(playlists[0]);
    select.value = nextId;
    const selected = playlists.find(playlist => playlistId(playlist) === nextId);
    setState({
        songloftTargetPlaylistId: nextId,
        songloftTargetPlaylistName: selected ? playlistName(selected) : '',
    });
}

export async function loadSongloftTargetPlaylists() {
    const data = await fetchSongloftPlaylists();
    const playlists = asArray(data);
    setState({ songloftTargetPlaylists: playlists });
    renderTargetPlaylists(targetNodes().filter?.value || '');
    return playlists;
}

export function closeSongloftPlaylistTarget() {
    const { dialog } = targetNodes();
    if (dialog) {
        dialog.hidden = true;
        dialog.setAttribute?.('aria-hidden', 'true');
    }
}

export async function openSongloftPlaylistTarget(songs, options = {}) {
    const pendingSongs = asArray(songs);
    if (!pendingSongs.length) {
        throw new Error('请先选择歌曲');
    }

    const { dialog, name, count } = targetNodes();
    setState({ songloftTargetPendingSongs: pendingSongs });
    if (count) count.textContent = `${pendingSongs.length} 首待加入`;
    if (name) name.value = options.playlistName || '';
    if (options.playlistId) {
        setState({ songloftTargetPlaylistId: String(options.playlistId) });
    }
    await loadSongloftTargetPlaylists();
    if (dialog) {
        dialog.hidden = false;
        dialog.setAttribute?.('aria-hidden', 'false');
    }
    name?.focus?.();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Group import error messages into short reason buckets for UI display.
 * @param {Array<{ title?: string, message?: string }>|undefined} errors
 * @param {number} maxReasons
 */
export function summarizeImportSkipReasons(errors, maxReasons = 4) {
    const list = Array.isArray(errors) ? errors : [];
    if (!list.length) return '';

    const buckets = new Map();
    for (const item of list) {
        const raw = String(item?.message || '未知原因').trim() || '未知原因';
        const reason = classifySkipReason(raw);
        const entry = buckets.get(reason) || { count: 0, samples: [] };
        entry.count += 1;
        if (entry.samples.length < 2 && item?.title) {
            entry.samples.push(String(item.title).trim());
        }
        buckets.set(reason, entry);
    }

    return Array.from(buckets.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, maxReasons)
        .map(([reason, entry]) => {
            const sample = entry.samples.length ? `（如 ${entry.samples.join('、')}）` : '';
            return `${reason} ${entry.count} 首${sample}`;
        })
        .join('；');
}

function classifySkipReason(message) {
    const text = String(message || '');
    if (/未找到可用音源|no playable|无可用|解析|播放音源/.test(text)) return '各平台均无可用源';
    if (/vip|会员|付费|版权|下架|region|地区/i.test(text)) return '版权/会员限制';
    if (/timeout|超时|network|网络|ECONN|fetch failed/i.test(text)) return '网络/超时';
    if (/未返回.*song id|未能回查到 song id|song id/i.test(text)) return '入库无 song id';
    if (/title is required|未知歌曲/i.test(text)) return '歌曲信息不完整';
    if (/duplicate|已有该歌曲/i.test(text)) return '曲库重复但未关联';
    // Keep a short raw message as fallback.
    return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

export function songloftImportSummary(result, context = {}) {
    const name = context.targetPlaylistName
        || playlistNameFromResult(result?.playlist)
        || '';
    const added = Number(result?.added ?? 0);
    const skipped = Number(result?.skipped ?? 0);
    const imported = Number(result?.imported ?? 0);
    const sourceTotal = Number(result?.source_total ?? 0);
    const resolution = result?.conflict_resolution || '';
    const resolutionLabel = resolution === 'overwrite'
        ? '（已覆盖同名）'
        : resolution === 'rename'
            ? '（已重命名新建）'
            : resolution === 'created'
                ? '（新建）'
                : '';
    const parts = [
        name ? `「${name}」` : '歌单',
        `成功 ${added} 首`,
    ];
    if (imported > 0 && imported !== added) parts.push(`入库 ${imported} 首`);
    if (sourceTotal > 0) parts.push(`源 ${sourceTotal} 首`);
    if (skipped > 0) parts.push(`跳过 ${skipped}`);
    let summary = `已导入 Songloft${resolutionLabel}：${parts.join('，')}`;
    if (skipped > 0) {
        const reasons = summarizeImportSkipReasons(result?.errors);
        if (reasons) {
            summary += `。跳过原因：${reasons}`;
        } else {
            summary += '。跳过多为：无播放地址/版权限制/解析失败/入库未返回 id';
        }
    }
    return summary;
}

function jobProgressFingerprint(job) {
    const progress = job?.progress || {};
    return [
        job?.status || '',
        job?.updated_at || '',
        progress.stage || '',
        progress.current ?? '',
        progress.total ?? '',
        progress.message || '',
    ].join('|');
}

function formatImportProgressMessage(job, elapsedMs) {
    const progress = job?.progress;
    const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
    if (progress?.message) {
        const ratio = progress.total > 0
            ? ` ${progress.current}/${progress.total}`
            : '';
        return `${progress.message}${ratio ? '' : ''} · 已等待 ${elapsedSec} 秒`;
    }
    return `正在导入 Songloft… 已等待 ${elapsedSec} 秒`;
}

export async function waitForSongloftImportJob(jobId, options = {}) {
    const id = String(jobId || '').trim();
    if (!id) {
        throw new Error('Songloft 导入任务缺少 ID');
    }

    const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : IMPORT_JOB_POLL_INTERVAL_MS;
    const maxPolls = Number(options.maxPolls) > 0 ? Number(options.maxPolls) : IMPORT_JOB_MAX_POLLS;
    const maxTotalMs = Number(options.maxTotalMs) > 0 ? Number(options.maxTotalMs) : IMPORT_JOB_MAX_TOTAL_MS;
    const maxIdleMs = Number(options.maxIdleMs) > 0 ? Number(options.maxIdleMs) : IMPORT_JOB_MAX_IDLE_MS;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    let lastFingerprint = '';

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > maxTotalMs) {
            throw new Error(
                `歌单导入超过 ${Math.round(maxTotalMs / 60000)} 分钟仍未结束。若 Songloft 已出现歌单歌曲，说明后台可能已完成，请刷新歌单列表确认。`,
            );
        }

        let job;
        try {
            job = await api.get(`/songloft/playlists/import-jobs/${encodeURIComponent(id)}`);
        } catch (error) {
            // Transient poll failure: keep waiting unless idle budget is exhausted.
            if (Date.now() - lastActivityAt > maxIdleMs) {
                throw error instanceof Error ? error : new Error(String(error || '查询导入任务失败'));
            }
            onProgress?.({
                status: 'running',
                attempt: attempt + 1,
                elapsedMs: Date.now() - startedAt,
                message: `查询任务状态失败，重试中… ${error?.message || error}`,
            });
            await delay(intervalMs);
            continue;
        }

        const fingerprint = jobProgressFingerprint(job);
        if (fingerprint && fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            lastActivityAt = Date.now();
        }

        if (job?.status === 'done') {
            onProgress?.({
                status: 'done',
                attempt: attempt + 1,
                elapsedMs: Date.now() - startedAt,
                result: job.result,
                progress: job.progress,
            });
            return job.result;
        }
        if (job?.status === 'failed') {
            const message = job?.error?.message || '歌单导入失败';
            onProgress?.({
                status: 'failed',
                attempt: attempt + 1,
                elapsedMs: Date.now() - startedAt,
                message,
                progress: job.progress,
            });
            throw new Error(message);
        }

        if (Date.now() - lastActivityAt > maxIdleMs) {
            throw new Error(
                `导入任务超过 ${Math.round(maxIdleMs / 60000)} 分钟没有进度更新。请到 Songloft 歌单列表确认是否已部分导入成功。`,
            );
        }

        onProgress?.({
            status: 'running',
            attempt: attempt + 1,
            elapsedMs: Date.now() - startedAt,
            message: formatImportProgressMessage(job, Date.now() - startedAt),
            progress: job?.progress,
        });
        await delay(intervalMs);
    }
    throw new Error('歌单导入轮询次数用尽，请稍后在 Songloft 歌单列表中确认结果');
}

function applySongloftImportResult(result, context = {}) {
    const playlist = result?.playlist;
    const nextId = playlistId(playlist) || context.targetPlaylistId || '';
    const nextName = context.newPlaylistName || playlistNameFromResult(playlist) || context.targetPlaylistName || '';
    if (nextId || nextName) {
        setState({
            ...(nextId ? { songloftTargetPlaylistId: nextId } : {}),
            ...(nextName ? { songloftTargetPlaylistName: nextName } : {}),
        });
    }
}

function toastImportResult(message, type = 'success') {
    // Import results stay longer so users can read counts after a long job.
    const existing = $('.toast');
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), type === 'error' ? 8000 : 7000);
}

/**
 * Poll a Songloft import job and report the final result.
 * @param {string} jobId
 * @param {{ targetPlaylistName?: string, onProgress?: Function, throwOnError?: boolean }} context
 */
export function trackSongloftImportJob(jobId, context = {}) {
    const silent = Boolean(context.silent);
    return waitForSongloftImportJob(jobId, {
        onProgress: context.onProgress,
        intervalMs: context.intervalMs,
        maxPolls: context.maxPolls,
    })
        .then(result => {
            applySongloftImportResult(result, context);
            const summary = songloftImportSummary(result, context);
            if (!silent) {
                toastImportResult(summary, 'success');
            }
            setState({ message: summary });
            return result;
        })
        .catch(error => {
            const message = error?.message || '歌单导入失败';
            setState({ message });
            if (context.throwOnError) {
                throw (error instanceof Error ? error : new Error(message));
            }
            if (!silent) {
                toastImportResult(message, 'error');
            }
            return null;
        });
}

async function importSongsToSongloftPlaylist(payload, context = {}) {
    const started = await api.post('/songloft/playlists/import-songs/jobs', payload);
    if (started?.job_id) {
        toast('已开始加入歌单，正在后台处理');
        void trackSongloftImportJob(started.job_id, context);
        return started;
    }
    applySongloftImportResult(started, context);
    toast(songloftImportSummary(started));
    return started;
}

export async function submitSongloftPlaylistTarget() {
    const { select, name, confirm } = targetNodes();
    const songs = asArray(state.songloftTargetPendingSongs);
    if (!songs.length) {
        throw new Error('没有待加入的歌曲');
    }

    const newPlaylistName = String(name?.value || '').trim();
    const targetPlaylistId = String(select?.value || state.songloftTargetPlaylistId || '').trim();
    if (!newPlaylistName && !targetPlaylistId) {
        throw new Error('请选择或新建歌单');
    }

    if (confirm) confirm.disabled = true;
    try {
        const payload = newPlaylistName
            ? { playlist_name: newPlaylistName, songs }
            : { playlist_id: targetPlaylistId, songs };
        const targetPlaylistName = newPlaylistName || playlistName(selectedTargetPlaylist()) || '';
        const result = await importSongsToSongloftPlaylist(payload, {
            targetPlaylistId,
            targetPlaylistName,
            newPlaylistName,
        });
        setState({
            ...(targetPlaylistId ? { songloftTargetPlaylistId: targetPlaylistId } : {}),
            ...(targetPlaylistName ? { songloftTargetPlaylistName: targetPlaylistName } : {}),
            songloftTargetPendingSongs: [],
        });
        closeSongloftPlaylistTarget();
        return result;
    } finally {
        if (confirm) confirm.disabled = false;
    }
}

function playlistNameFromResult(playlist) {
    return playlist ? playlistName(playlist) : '';
}

export function bindSongloftPlaylistTarget() {
    const { form, filter, select, refresh, cancel } = targetNodes();
    form?.addEventListener('submit', event => {
        event.preventDefault();
        submitSongloftPlaylistTarget().catch(error => toast(error.message, 'error'));
    });
    filter?.addEventListener('input', () => renderTargetPlaylists(filter.value));
    select?.addEventListener('change', () => {
        const selected = asArray(state.songloftTargetPlaylists)
            .find(playlist => playlistId(playlist) === select.value);
        setState({
            songloftTargetPlaylistId: select.value,
            songloftTargetPlaylistName: selected ? playlistName(selected) : '',
        });
    });
    refresh?.addEventListener('click', () => {
        loadSongloftTargetPlaylists().catch(error => toast(error.message, 'error'));
    });
    cancel?.addEventListener('click', () => closeSongloftPlaylistTarget());
}
