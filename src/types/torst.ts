// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

export type TorrentRetention = 'persisted' | 'temporary';

export type TorrentStorage = 'memory' | 'file';

type AuthType = 'none' | 'bearer';

export interface TorstInstance {
  accessToken?: string,
  accessTokenExpiresAtMs?: number,
  authType: AuthType,
  checkedAtMs?: number,
  checkedUrl?: string,
  enableDownloader?: boolean,
  id: string,
  latencyMs?: number,
  name: string,
  password?: string,
  playbackToken?: string,
  playbackTokenExpiresAtMs?: number,
  profileId?: string,
  profileName?: string,
  status?: 'online' | 'offline' | 'checking' | 'unknown',
  url: string
}

export interface TorstSettings {
  [key: string]: unknown,
  background_downloads_enabled?: boolean
}

export interface TorrentFile {
  fileId?: string,
  length: number,
  name: string,
  path: string
}

export interface Torrent {
  file_count?: number,
  files: TorrentFile[],
  hash: string,
  id?: string,
  isPaused?: boolean,
  name: string,
  poster?: string,
  retention: TorrentRetention,
  storage: TorrentStorage,
  title?: string,
  total_size: number
}

export interface TorrentsResponse {
  torrents: Torrent[]
}

export interface TorrentAdd {
  hash?: string,
  magnet?: string,
  poster?: string,
  retention?: TorrentRetention,
  storage?: TorrentStorage,
  title?: string
}

export interface TorrentUpdate {
  storage: TorrentStorage
}

export interface PreloadRequest {
  file_index?: number,
  file_path?: string,
  playbackFraction?: number
}

export interface PreloadResponse {
  active_peers?: number,
  completed_bytes?: number,
  download_rate?: number,
  preloadId?: string,
  status: 'evicted' | 'failed' | 'idle' | 'preloading' | 'queued' | 'ready',
  target_bytes?: number,
  total_peers?: number
}

export interface AccessTokenResponse {
  expires_at: string | null,
  secret: string
}

export interface PlaybackTokenResponse {
  expires_at: string,
  token: string
}

export interface ParsedFileInfo {
  episode: number | null,
  hash: number | string,
  season: number | null,
  serial: boolean
}

export interface PlayOptions {
  saveToDb: boolean,
  storage: TorrentStorage
}

export interface TorstProfile {
  avatar?: { updated_at: string } | null,
  id: string,
  kind: string,
  name: string
}

export interface ProgressUpdate {
  duration_seconds: number,
  position_seconds: number,
  viewed: boolean
}

export interface FileProgress extends ProgressUpdate {
  completion_ratio: number,
  file_id: string,
  updated_at: string,
  viewed_at: string | null
}

export interface FileViewing {
  duration_seconds: number | null,
  id: string,
  links: { self: string },
  position_seconds: number | null,
  streaming: boolean
}

export interface UpNextEntry {
  file: TorrentFile,
  id: string,
  progress: FileProgress | null,
  reason: string,
  torrent: Torrent
}

export interface TitleProgress extends ProgressUpdate {
  completion_ratio: number,
  file_id: string | null,
  title_key: string,
  torrent_id: string | null,
  updated_at: string,
  viewed_at: string | null
}
