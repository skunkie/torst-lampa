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
  status?: 'online' | 'offline' | 'checking' | 'unknown',
  url: string
}

export interface TorstSettings {
  [key: string]: unknown,
  background_downloads?: boolean
}

export interface TorrentFile {
  fileId?: string,
  length: number,
  name: string,
  path: string
}

export interface Torrent {
  created_at?: string,
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

export interface TorrentCategoryCount {
  count: number,
  name: string
}

export interface TorrentFacets {
  categories: TorrentCategoryCount[],
  total: number,
  version: string
}

export interface TorrentsResponse {
  facets: TorrentFacets,
  torrents: Torrent[],
  total?: number
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

export interface TokenResponse {
  expires_at: string | null,
  secret: string
}

export interface ScopedToken {
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
