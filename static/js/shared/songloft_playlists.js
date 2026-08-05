import { api } from '../api.js';
import { asArray } from './arrays.js';

/** Normalize Songloft playlist id from mixed host shapes. */
export function songloftPlaylistId(playlist) {
    const id = playlist?.id ?? playlist?.playlist_id ?? playlist?.playlistId;
    return id === undefined || id === null ? '' : String(id);
}

export function songloftPlaylistName(playlist) {
    return playlist?.name || playlist?.title || playlist?.playlist_name || '未命名歌单';
}

export function songloftPlaylistCount(playlist) {
    return playlist?.song_count ?? playlist?.songCount ?? playlist?.count ?? playlist?.total ?? 0;
}

export function isNormalSongloftPlaylist(playlist) {
    return String(playlist?.type || '').trim().toLowerCase() !== 'radio';
}

export function playableSongloftPlaylistId(id) {
    const parsed = Number(id);
    if (!Number.isFinite(parsed)) throw new Error('Songloft 歌单 ID 无效');
    return parsed;
}

/** Fetch Songloft playlists once; optional filter for speaker UI. */
export async function fetchSongloftPlaylists({ normalOnly = false } = {}) {
    const data = await api.get('/songloft/playlists');
    const playlists = asArray(data);
    return normalOnly ? playlists.filter(isNormalSongloftPlaylist) : playlists;
}

/**
 * Fetch songs for a Songloft playlist id.
 *
 * `withMeta` keeps host/plugin envelope fields such as `expired`, which is
 * needed when an in-memory temporary playlist has disappeared between list
 * and detail requests. The default remains the historical array-only shape.
 */
export async function fetchSongloftPlaylistSongs(playlistId, { withMeta = false } = {}) {
    const id = playableSongloftPlaylistId(playlistId);
    const path = `/songloft/playlists/${encodeURIComponent(id)}/songs`;
    if (!withMeta) {
        return asArray(await api.get(path));
    }
    const envelope = await api.getEnvelope(path);
    const payload = envelope?.data;
    const nestedExpired = payload && typeof payload === 'object' && payload.expired === true;
    return {
        ...envelope,
        ...(envelope?.expired === true || nestedExpired ? { expired: true } : {}),
        data: asArray(payload),
    };
}
