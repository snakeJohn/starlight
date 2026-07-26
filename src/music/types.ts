export type MusicPlatform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';

export type MusicQuality = '128k' | '320k' | 'flac' | 'flac24bit';

export interface MusicSourceMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  filename: string;
  importedAt: string;
  enabled: boolean;
  supportedPlatforms: string[];
}

export interface MusicSourceScript {
  id: string;
  script: string;
}

export interface LxSongInfo {
  source: string;
  name: string;
  singer: string;
  album: string;
  duration: number;
  id?: string;
  mid?: string;
  musicId?: string;
  rid?: string;
  songId?: string;
  songmid?: string;
  hash?: string;
  copyrightId?: string;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
  types?: Array<{ type: MusicQuality | string; size?: string }>;
}

export interface SearchResultSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  source_data: {
    platform: MusicPlatform;
    quality: MusicQuality;
    songInfo: LxSongInfo;
  };
}
