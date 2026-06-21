# Songlist Cover And Playlist Playback Design

## Goal

Improve the music discovery UI so songlists, leaderboards, and songs read like user-facing music content instead of transport/debug data. Add a whole-songlist playback action that reuses the existing Songloft import and MIoT playback bridge.

## Requirements

- Show cover artwork for songlist cards, leaderboard/detail song rows, and search song rows when a source provides a cover URL.
- Hide provider/internal IDs from the visible UI, including values such as `kw__16`, `kg__8888`, and numeric playlist IDs.
- Keep those IDs in state only for detail API calls.
- Add a `播放整个歌单` action in songlist detail after songs are loaded.
- The whole-songlist action uses the approved A flow: resolve and import the current songlist into Songloft, then play the first imported/detail song on the currently selected MIoT speaker.
- Reuse the current selected account/device state. If either is missing, show the same style of inline toast used by single-song speaker playback.
- Leave the existing `导入当前歌单`, single-song `试听`, `导入`, and `音箱` actions available.

## UI Design

Song rows become media rows: square artwork on the left, title/artist/album/time in the main area, and actions on the right. If a song has no cover URL, use a neutral placeholder with a music-note label.

Songlist and leaderboard list rows also use artwork where available. Their visible secondary text is description, creator, play count, or source name; raw IDs are not shown. The UI can still store each item in `state.songlists` or `state.rankingBoards`, and helper functions can read the hidden ID when loading details.

The songlist detail section gains grouped actions above or below the detail songs:

- `播放整个歌单`
- `导入当前歌单`

On mobile, actions wrap under the media text without causing horizontal overflow.

## Data Flow

Search, songlist detail, and leaderboard detail continue to use existing `/api/music/...` endpoints. Rendering helpers normalize cover fields from `cover_url`, `img`, `pic`, `cover`, or common provider variants.

Whole-songlist playback calls a new bridge helper from the front end. The bridge should avoid a new backend endpoint unless needed: the front end can call existing `/bridge/songs/import` with all current detail songs, then call `/bridge/play-url` with the first song and the selected device payload. This keeps behavior consistent with the current single-song and import flows.

## Error Handling

- Empty songlist: show a toast and do not call bridge APIs.
- Missing selected account/device: show the existing "choose account/device first" error.
- Import failure: show the API error and do not start playback.
- Playback failure after import: show the playback error; imported songs remain available in Songloft.

## Testing

Add front-end unit coverage for the pure rendering helpers used by media rows and ID hiding. Add behavior coverage for the whole-songlist helper to prove it calls import first and then speaker playback with the first song. Run the existing full verification suite after implementation.
