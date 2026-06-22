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
- Add custom playlists that can be created, renamed, deleted, and populated from search results, discovered songlists, leaderboard songs, or voice commands.
- When saving a song into a custom playlist, persist the selected music source alongside the song, for example `稻花香 - 周杰伦（酷我）` or `为龙 - 河图（酷狗）`.
- Store the full LX `source_data` for every custom playlist song so later URL resolution uses the original source and quality.
- Support voice-created custom playlists and voice add-song commands.

## UI Design

Song rows become media rows: square artwork on the left, title/artist/album/time in the main area, and actions on the right. If a song has no cover URL, use a neutral placeholder with a music-note label.

Songlist and leaderboard list rows also use artwork where available. Their visible secondary text is description, creator, play count, or source name; raw IDs are not shown. The UI can still store each item in `state.songlists` or `state.rankingBoards`, and helper functions can read the hidden ID when loading details.

The songlist detail section gains grouped actions above or below the detail songs:

- `播放整个歌单`
- `导入当前歌单`

On mobile, actions wrap under the media text without causing horizontal overflow.

The songlist tab also includes a custom playlist area. Users can create a playlist by name, pick an existing custom playlist, and add songs from search, songlist detail, or leaderboard detail rows. The visible saved-song label includes the source display name in parentheses and does not expose raw platform IDs.

## Data Flow

Search, songlist detail, and leaderboard detail continue to use existing `/api/music/...` endpoints. Rendering helpers normalize cover fields from `cover_url`, `img`, `pic`, `cover`, or common provider variants.

Whole-songlist playback calls a new bridge helper from the front end. The bridge should avoid a new backend endpoint unless needed: the front end can call existing `/bridge/songs/import` with all current detail songs, then call `/bridge/play-url` with the first song and the selected device payload. This keeps behavior consistent with the current single-song and import flows.

Custom playlist persistence uses the approved A approach:

1. Import custom playlist songs as Songloft remote songs, preserving `source_data` in each remote-song payload.
2. Prefer Songloft native playlist writes so the existing `IndexingManager`, voice `play_playlist` / `play_song`, scheduled tasks, and `PlaylistManager` can reuse the normal host playlist path.
3. If the Songloft runtime does not expose a native playlist write API, store custom playlists under plugin storage and expose them through Starlight handlers as a fallback. The fallback index participates in voice playlist/song matching, and playback resolves stored `source_data` through the LX runtime.

The saved song model keeps both a display source and the raw source data:

```ts
interface CustomPlaylistSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  source_name: string; // e.g. "酷我" or "酷狗"
  source_data: SearchResultSong["source_data"];
}
```

## Voice Custom Playlists

Rules add two new voice command types:

- `create_playlist`: examples include `创建歌单 我的收藏`, `新建歌单 古风`.
- `add_song_to_playlist`: examples include `把稻花香 周杰伦 酷我 加到 我的收藏`, `添加为龙 河图 酷狗 到古风`.

The add-song command parses a song title, optional artist, optional source name, and target playlist name. If a source name is supplied, search uses that platform first. If omitted, search follows the current platform order. On a successful match, the bridge imports the song, writes it to the target custom/native playlist, refreshes the index, and announces success through TTS. If a target playlist does not exist, the plugin creates it.

When AI command analysis is enabled, the analyzer prompt and result schema add `create_playlist` and `add_song_to_playlist` actions with `playlist`, `name`, `artist`, and `source` params. High-confidence AI results execute before rule matching, consistent with existing behavior.

## Error Handling

- Empty songlist: show a toast and do not call bridge APIs.
- Missing selected account/device: show the existing "choose account/device first" error.
- Import failure: show the API error and do not start playback.
- Playback failure after import: show the playback error; imported songs remain available in Songloft.
- Duplicate custom playlist names resolve to the existing playlist rather than creating another with the same name.
- Duplicate songs in the same custom playlist are ignored by `platform + stable song id` dedupe.
- Voice add-song failures speak a concise reason, such as `未找到歌曲` or `未找到音源`.

## Testing

Add front-end unit coverage for the pure rendering helpers used by media rows and ID hiding. Add behavior coverage for the whole-songlist helper to prove it calls import first and then speaker playback with the first song. Run the existing full verification suite after implementation.

Add storage/service tests for custom playlist creation, dedupe, source retention, and native-write fallback. Add voice-engine tests for parsing create/add commands and for refreshing the index after a voice-created playlist changes.
