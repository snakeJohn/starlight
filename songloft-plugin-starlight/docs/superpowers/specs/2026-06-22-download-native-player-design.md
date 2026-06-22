# Download Sources And Native Player Design

## Goal

Add song downloading to Starlight without mixing playback and download sources, and replace the in-plugin audio preview footer with a request path that targets Songloft's native bottom player when the host exposes a playback hook.

## Requirements

- Download sources are a separate user-managed source set. Playback sources must never be used for downloads, and download sources must never be used for playback.
- No LX source file is bundled, preloaded, or default-enabled.
- Song download resolves the audio URL through enabled download sources, imports or reuses the song in Songloft, then calls `songloft.songs.download(song_id, { path_template, embed_metadata })`.
- Download settings include path template, metadata embedding, and batch interval.
- Single-song and batch downloads are exposed through plugin APIs and UI actions.
- The old Starlight mini audio player is removed.
- "播放" imports or reuses a Songloft remote song and then asks the host page to play it with the native player. If the current Songloft shell does not expose a plugin-to-player hook, Starlight shows a clear fallback message and keeps the song imported in Songloft.
- Do not modify `songloft-player`.

## Architecture

Playback and download source isolation is implemented by making `SourceStore` configurable. Starlight creates two `SourceManager` plus `RuntimeManager` pairs: the existing playback pair keeps `starlight:music:sources`, while the download pair uses `starlight:music:download_sources`.

`BridgeService.importSongs()` is enhanced to parse the Songloft `/api/v1/songs/remote` success body and return `songs` alongside existing payload data. Remote imports use a Starlight plugin entry path and dedup key so repeated imports can reuse Songloft song ids.

`DownloadService` owns download settings, source URL resolution, remote-song import, `songloft.songs.download()`, and in-memory batch progress. It receives only the download runtime manager, so it cannot fall back to playback sources.

Frontend changes stay inside Starlight static assets. `native_player.js` sends a best-effort host playback request via same-origin hooks or `postMessage`. This is intentionally a request adapter, not a `songloft-player` patch.

## Error Handling

Malformed API bodies return `BAD_REQUEST`. Missing download URL resolution returns `PLAY_URL_RESOLVE_FAILED`. Upstream Songloft import/download failures return `INTERNAL_ERROR` with retryable user-facing messages where appropriate. Batch download continues after per-song failures and records failed items in progress.

## Testing

- Source store tests verify playback and download source indexes/scripts are isolated.
- Bridge service tests verify Songloft import responses include returned songs and dedup data.
- Download service tests verify download URL resolution only uses the download runtime and calls `songloft.songs.download`.
- Download handler tests verify source management, settings, single download, and batch progress routes.
- Static UI tests verify the mini player is removed and download source UI exists.
- UI action tests verify "播放" no longer creates `<audio>` and sends a native-player request/fallback instead.

## Non-Goals

- Do not guarantee native bottom-player playback in host builds that expose no plugin playback API.
- Do not change `songloft-player`.
- Do not add default download sources.
- Do not use paid LX source files for implementation or tests.
