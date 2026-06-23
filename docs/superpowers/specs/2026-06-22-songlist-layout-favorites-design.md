# Songlist Layout Favorites Design

## Goal

Optimize the songlist tab so playlist management follows the user's workflow: saved playlists first, manual import second, playlist discovery last. Fix broken media display in playlist and song rows, and allow discovered playlists to be collected into "我的歌单".

## Requirements

- The songlist tab is ordered top to bottom as `我的歌单`, `导入歌单`, `搜索歌单`.
- `我的歌单` contains self-built playlists and collected network playlists from existing custom playlist storage.
- `导入歌单` remains a separate middle section and continues to import by platform plus playlist link or ID.
- `搜索歌单` contains the platform/keyword search controls, search result list, selected playlist detail, pagination, and songlist detail playback/import actions.
- Search result playlist rows expose a `收藏` action. Collecting a row imports that source playlist through the existing `/custom-playlists/import` API and reloads `我的歌单`.
- Visible UI hides provider IDs such as `3360244412`, `kw__16`, and `kg__8888`.
- Playlist descriptions are cleaned before display: decode HTML entities, convert literal `\u003cbr\u003e` and `<br>` breaks to spaces, strip remaining tags, and collapse repeated whitespace.
- Media rows render covers from common source fields including `cover_url`, `coverUrl`, `picUrl`, `pic_url`, `imgurl`, `album_img`, `album_sizable_cover`, `image`, and nested `source_data`.
- Broken image loads fall back to the stable music placeholder without exposing alt text inside the artwork square.
- Song rows use clearer labels: `播放` for page preview/playback and `导入 Songloft 歌曲库` for importing to the Songloft song library.

## Architecture

Keep the backend unchanged for this feature. The existing custom playlist import endpoint already fetches source playlist detail, imports its songs, stores source metadata, and creates Songloft-native playlists when available.

Frontend changes stay in three areas:

- `static/index.html`: reorder songlist sections and rename the discovery section.
- `static/js/music.js`: add pure helpers for cover normalization, safe summary text, artwork fallback, and source playlist collection.
- `static/css/style.css`: constrain row layout so covers, long descriptions, and actions do not overlap or stretch rows beyond the viewport.

## Error Handling

If a discovered playlist lacks a usable ID, collecting or opening details shows the existing toast error path. If `/custom-playlists/import` fails, the row button is re-enabled and the error is shown through toast. Broken image URLs are handled locally by replacing the image element with the placeholder state.

## Testing

Use Vitest UI/static tests before implementation:

- Static layout test verifies section order: `我的歌单` before `导入歌单` before `搜索歌单`.
- Rendering tests verify songlist rows include `收藏`, clean escaped descriptions, hide IDs, and normalize additional cover fields.
- Rendering tests verify song buttons show `播放` and `导入 Songloft 歌曲库`.
- Custom playlist UI tests verify source playlist collection posts to `api/custom-playlists/import` and reloads playlist state.

## Non-Goals

- Do not preset or bundle any LX music source.
- Do not read, copy, package, or reference paid source files.
- Do not add a new backend favorite table; collected playlists are custom playlists.
- Do not change provider APIs unless tests show provider-level data cannot be normalized in the UI.
