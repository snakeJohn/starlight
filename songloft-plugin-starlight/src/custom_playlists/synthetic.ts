const PLAYLIST_BASE = -100000;
const SONG_BASE = -100000000;
const SONG_STRIDE = 100000;

export function syntheticPlaylistId(index: number): number {
  return PLAYLIST_BASE - index;
}

export function customPlaylistIndexFromSyntheticId(id: number): number {
  if (!Number.isInteger(id) || id > PLAYLIST_BASE) {
    return -1;
  }
  return PLAYLIST_BASE - id;
}

export function syntheticSongId(playlistIndex: number, songIndex: number): number {
  return SONG_BASE - playlistIndex * SONG_STRIDE - songIndex;
}
