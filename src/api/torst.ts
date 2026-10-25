// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import {
  FileProgress,
  PreloadRequest,
  PreloadResponse,
  ProgressUpdate,
  Torrent,
  TorrentAdd,
  TorrentFile,
  TorrentRetention,
  TorrentsResponse,
  TorrentUpdate,
  TorstInstance,
  TorstProfile,
  TorstSettings,
  UpNextEntry,
} from '../types/torst';
import { AuthenticationError, AuthManager } from './auth';
import { isNetworkError, requestHttp } from './http-client';

export class TorstApiError extends Error {
  public resource?: string;
  public status: number;

  constructor(message: string, status: number, resource?: string) {
    super(message);
    this.name = 'TorstApiError';
    this.resource = resource;
    this.status = status;
  }
}

export class PreloadStartUnconfirmedError extends Error {
  constructor() {
    super('Could not confirm whether Torst started the preload');
    this.name = 'PreloadStartUnconfirmedError';
  }
}

interface ResourcePage<T> {
  items: T[],
  links: { next?: string }
}

interface TorstTorrent {
  failure?: { detail: string } | null,
  file_count: number | null,
  id: string,
  info_hashes: Array<{ algorithm: string, value: string }>,
  name: string | null,
  observed_state: string,
  poster: object | null,
  retention: TorrentRetention,
  size_bytes: number | null,
  storage_mode: 'disk' | 'memory',
  title: string | null
}

interface TorstFile {
  id: string,
  path: string[],
  size_bytes: number
}

interface TorstPreload {
  completed_bytes: number,
  id: string,
  state: 'downloading' | 'expired' | 'failed' | 'queued' | 'ready',
  target_bytes: number
}

interface TorstStatistics {
  download_rate_bytes_per_second: number,
  peer_count: number
}

interface ActivePreload {
  id: string,
  instance: TorstInstance,
  path: string,
  request: PreloadRequest
}

export function normalizeInfoHash(candidate?: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^[a-zA-Z2-7]{32}$/.test(trimmed)) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = 0;
    let value = 0;
    let hex = '';

    for (let i = 0; i < trimmed.length; i++) {
      const idx = alphabet.indexOf(trimmed[i].toLowerCase());
      if (idx === -1) return null;
      value = (value << 5) | idx;
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        const byte = (value >>> bits) & 0xff;
        hex += byte.toString(16).padStart(2, '0');
      }
    }

    return hex.length === 40 ? hex : null;
  }
  return null;
}

export function extractHashFromMagnet(magnetUri: string): string | null {
  if (!/^magnet:\?/i.test(magnetUri)) return null;
  const parameters = new URLSearchParams(magnetUri.slice(magnetUri.indexOf('?') + 1));
  for (const [key, value] of parameters) {
    if (key.toLowerCase() !== 'xt' || !/^urn:btih:/i.test(value)) continue;
    const hash = normalizeInfoHash(value.slice('urn:btih:'.length));
    if (hash) return hash;
  }
  return null;
}

export class TorstApi {
  private static pages = new Map<string, { data: ResourcePage<unknown>, etag?: string }>();
  private static torrents = new Map<string, Torrent>();
  private static preloads = new Map<string, ActivePreload>();
  private static preloadStarts = new Map<string, Promise<void>>();

  private static cacheKey(instance: TorstInstance, hash: string): string {
    return `${instance.id}\u0001${instance.url}\u0001${hash.toLowerCase()}`;
  }

  private static ensureInstanceUnchanged(instance: TorstInstance, original: TorstInstance): void {
    if (instance.url !== original.url || instance.password !== original.password || instance.authType !== original.authType) {
      throw new AuthenticationError('Instance authentication settings changed; retry the request');
    }
  }

  public static async checkHealth(instance: TorstInstance, timeoutMs = 4000): Promise<{ isOk: boolean, latencyMs: number }> {
    const startedAtMs = performance.now();
    const checkedUrl = instance.url;
    try {
      const response = await requestHttp(`${checkedUrl.replace(/\/+$/, '')}/readyz`, { timeoutMs });
      if (instance.url !== checkedUrl) return { isOk: false, latencyMs: Infinity };
      if (response.ok) {
        instance.checkedAtMs = Date.now();
        instance.checkedUrl = checkedUrl;
        instance.latencyMs = Math.round(performance.now() - startedAtMs);
        instance.status = 'online';
        return { isOk: true, latencyMs: instance.latencyMs };
      }
    } catch {}
    if (instance.url === checkedUrl) {
      instance.status = 'offline';
      instance.latencyMs = Infinity;
    }
    return { isOk: false, latencyMs: Infinity };
  }

  private static async request<T>(
    instance: TorstInstance,
    path: string,
    options: { body?: string | FormData | Blob, headers?: Record<string, string>, method?: string, needsResponseHeaders?: boolean, responseType?: 'blob', timeoutMs?: number } = {},
    shouldRetryAuthentication = true
  ): Promise<{ data: T, etag?: string }> {
    // Only instance-relative API links are followed, so credentials never leave this instance.
    if (!path.startsWith('/api/v1/') || !new URL(path, 'http://torst.invalid').pathname.startsWith('/api/v1/')) {
      throw new TorstApiError('Invalid Torst resource link', 0);
    }
    const original = { ...instance };
    const headers = { ...await AuthManager.getAuthHeaders(instance), ...options.headers };
    this.ensureInstanceUnchanged(instance, original);
    const response = await requestHttp(`${instance.url.replace(/\/+$/, '')}${path}`, {
      ...options,
      headers,
    });
    this.ensureInstanceUnchanged(instance, original);
    if (response.status === 401 && shouldRetryAuthentication && instance.authType === 'bearer') {
      AuthManager.rejectAccessToken(instance, headers['Authorization']);
      return this.request<T>(instance, path, options, false);
    }
    if (response.status === 304) return { data: undefined as T };
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText || ''}`.trim();
      let resource: string | undefined;
      try {
        const problem = await response.json() as { detail?: string, title?: string, torrent?: string };
        detail = problem.detail || problem.title || detail;
        resource = problem.torrent;
      } catch {}
      throw new TorstApiError(`Torst API error (${path}): ${detail}`, response.status, resource);
    }
    if (options.responseType === 'blob') return { data: await response.blob() as T, etag: response.headers?.get('ETag') || undefined };
    const text = await response.text();
    return { data: text ? await response.json() as T : undefined as T, etag: response.headers?.get('ETag') || undefined };
  }

  private static async collectPages<T>(instance: TorstInstance, path: string, shouldRevalidate = false): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let page: ResourcePage<T>;
    do {
      if (seen.has(path)) throw new TorstApiError('Torst repeated a pagination link', 0);
      seen.add(path);
      const key = `${instance.id}\u0001${instance.url}\u0001${path}`;
      const cached = shouldRevalidate ? this.pages.get(key) : undefined;
      const { data, etag } = await this.request<ResourcePage<T>>(instance, path, {
        headers: cached?.etag ? { 'If-None-Match': cached.etag } : undefined,
      });
      page = data || cached?.data as ResourcePage<T>;
      if (!page) throw new TorstApiError('Torst returned an empty page', 0);
      if (shouldRevalidate && data) {
        this.pages.delete(key);
        this.pages.set(key, { data, etag });
        if (this.pages.size > 32) this.pages.delete(this.pages.keys().next().value as string);
      }
      items.push(...page.items);
      path = page.links.next || '';
    } while (path);
    return items;
  }

  private static rememberTorrent(instance: TorstInstance, resource: TorstTorrent): Torrent {
    const hash = resource.info_hashes.find(info => info.algorithm === 'sha1')?.value || resource.id;
    const previous = this.torrents.get(this.cacheKey(instance, hash));
    const torrent: Torrent = {
      file_count: resource.file_count || 0,
      files: previous?.id === resource.id && resource.file_count !== null ? previous.files : [],
      hash,
      id: resource.id,
      isPaused: resource.observed_state === 'paused',
      name: resource.name || resource.title || hash,
      poster: resource.poster
        ? `${instance.url.replace(/\/+$/, '')}/api/v1/torrents/${encodeURIComponent(resource.id)}/poster`
        : undefined,
      retention: resource.retention,
      storage: resource.storage_mode === 'disk' ? 'file' : 'memory',
      title: resource.title || undefined,
      total_size: resource.size_bytes || 0,
    };
    this.torrents.set(this.cacheKey(instance, hash), torrent);
    this.torrents.set(this.cacheKey(instance, resource.id), torrent);
    while (this.torrents.size > 512) this.torrents.delete(this.torrents.keys().next().value as string);
    return torrent;
  }

  public static async addTorrent(instance: TorstInstance, torrentRequest: TorrentAdd): Promise<Torrent> {
    const hash = normalizeInfoHash(torrentRequest.hash) || extractHashFromMagnet(torrentRequest.magnet || '');
    const magnet = torrentRequest.magnet?.trim() || (hash ? `magnet:?xt=urn:btih:${hash}` : '');
    if (!magnet) throw new TorstApiError('A magnet URI or info hash is required', 422);
    const retention = torrentRequest.retention || 'persisted';
    return this.createTorrent(instance, JSON.stringify({
      magnet_uri: magnet,
      retention,
      storage_mode: retention === 'temporary' || torrentRequest.storage !== 'file' ? 'memory' : 'disk',
      title: retention === 'persisted' ? torrentRequest.title || undefined : undefined,
    }), torrentRequest);
  }

  private static async createTorrent(instance: TorstInstance, body: string | FormData, options: TorrentAdd): Promise<Torrent> {
    let resource: TorstTorrent;
    try {
      resource = (await this.request<TorstTorrent>(instance, '/api/v1/torrents', {
        body,
        headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
        method: 'POST',
      })).data;
    } catch (error) {
      if (!(error instanceof TorstApiError) || error.status !== 409 || !error.resource) throw error;
      resource = (await this.request<TorstTorrent>(instance, error.resource)).data;
      if (options.retention !== 'temporary' && resource.retention === 'temporary') {
        await this.patchResource(instance, `/api/v1/torrents/${encodeURIComponent(resource.id)}/configuration`, {
          retention: 'persisted',
          storage_mode: options.storage === 'file' ? 'disk' : 'memory',
          title: options.title || undefined,
        });
        resource = (await this.request<TorstTorrent>(instance, `/api/v1/torrents/${encodeURIComponent(resource.id)}`)).data;
      }
    }
    const torrent = this.rememberTorrent(instance, resource);
    if (options.retention !== 'temporary' && options.poster) {
      await this.uploadPoster(instance, torrent, options.poster).catch(() => {});
    }
    return torrent;
  }

  private static async uploadPoster(instance: TorstInstance, torrent: Torrent, url: string): Promise<void> {
    const original = { ...instance };
    const response = await requestHttp(url, { responseType: 'blob' });
    if (!response.ok) return;
    const image = await response.blob();
    this.ensureInstanceUnchanged(instance, original);
    if (image.size > 1024 * 1024) return;
    await this.request(instance, `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}/poster`, {
      body: image,
      headers: { 'Content-Type': image.type },
      method: 'PUT',
    });
  }

  public static async getTorrents(instance: TorstInstance, options?: {
    fuzzy?: boolean,
    hashes?: string[],
    retention?: TorrentRetention | 'any',
    search?: string,
    shouldRevalidate?: boolean
  }): Promise<TorrentsResponse> {
    const query = new URLSearchParams({ page_size: '200' });
    const retention = options?.retention;
    if (retention) query.set('retention', retention);
    if (options?.fuzzy) query.set('fuzzy', 'true');
    if (options?.search) query.set('search', options.search);
    for (const hash of options?.hashes || []) query.append('info_hash', hash);
    const resources = await this.collectPages<TorstTorrent>(instance, `/api/v1/torrents?${query}`, options?.shouldRevalidate !== false);
    const torrents = resources.map(resource => this.rememberTorrent(instance, resource));
    const token = torrents.some(torrent => torrent.poster) ? await AuthManager.getPlaybackToken(instance) : '';
    return {
      torrents: torrents.map(torrent => ({
        ...torrent,
        files: torrent.files.map(file => ({ ...file })),
        poster: torrent.poster && token ? `${torrent.poster}?token=${encodeURIComponent(token)}` : torrent.poster,
      })),
    };
  }

  private static async findTorrent(instance: TorstInstance, hash: string): Promise<Torrent> {
    const cached = this.torrents.get(this.cacheKey(instance, hash));
    if (cached) return cached;
    if (hash.startsWith('trr_')) {
      return this.rememberTorrent(instance, (await this.request<TorstTorrent>(instance, `/api/v1/torrents/${encodeURIComponent(hash)}`)).data);
    }
    const { torrents } = await this.getTorrents(instance, { hashes: [hash], retention: 'any', shouldRevalidate: false });
    const torrent = torrents.find(item => item.hash.toLowerCase() === hash.toLowerCase());
    if (!torrent) throw new TorstApiError('Torrent is not in Torst.', 404);
    return torrent;
  }

  public static async getTorrent(instance: TorstInstance, hash: string): Promise<Torrent> {
    let known = await this.findTorrent(instance, hash);
    let path = `/api/v1/torrents/${encodeURIComponent(known.id as string)}`;
    let data: TorstTorrent;
    try {
      data = (await this.request<TorstTorrent>(instance, path)).data;
    } catch (error) {
      if (!(error instanceof TorstApiError) || error.status !== 404) throw error;
      this.torrents.delete(this.cacheKey(instance, known.hash));
      this.torrents.delete(this.cacheKey(instance, known.id as string));
      if (!normalizeInfoHash(hash)) throw error;
      known = await this.findTorrent(instance, hash);
      path = `/api/v1/torrents/${encodeURIComponent(known.id as string)}`;
      data = (await this.request<TorstTorrent>(instance, path)).data;
    }
    if (data.observed_state === 'failed') throw new TorstApiError(data.failure?.detail || 'Torrent failed', 422);
    const torrent = this.rememberTorrent(instance, data);
    if (data.file_count !== null) {
      const files = await this.collectPages<TorstFile>(instance, `${path}/files?page_size=200`);
      torrent.files = files.map(file => ({
        fileId: file.id,
        length: file.size_bytes,
        name: file.path[file.path.length - 1],
        path: file.path.join('/'),
      }));
    }
    const token = torrent.poster ? await AuthManager.getPlaybackToken(instance) : '';
    return {
      ...torrent,
      files: torrent.files.map(file => ({ ...file })),
      poster: torrent.poster && token ? `${torrent.poster}?token=${encodeURIComponent(token)}` : torrent.poster,
    };
  }

  public static async resolveTorrent(instance: TorstInstance, url: string, options: TorrentAdd = {}, isAborted?: () => boolean): Promise<Torrent> {
    const original = { ...instance };
    if (isAborted?.()) throw new Error('Playback canceled');
    const response = await requestHttp(url, { responseType: 'blob' });
    if (!response.ok) throw new TorstApiError('Could not download the torrent file', response.status);
    const file = await response.blob();
    this.ensureInstanceUnchanged(instance, original);
    if (isAborted?.()) throw new Error('Playback canceled');
    if (file.size > 10 * 1024 * 1024) throw new TorstApiError('Torrent file exceeds Torst\'s 10 MiB limit', 413);
    const retention = options.retention || 'persisted';
    const form = new FormData();
    form.append('torrent_file', file, 'download.torrent');
    form.append('retention', retention);
    form.append('storage_mode', retention === 'temporary' || options.storage !== 'file' ? 'memory' : 'disk');
    if (retention === 'persisted' && options.title) form.append('title', options.title);
    return this.createTorrent(instance, form, options);
  }

  public static async deleteTorrent(instance: TorstInstance, hash: string): Promise<void> {
    const torrent = await this.findTorrent(instance, hash);
    await this.request(instance, `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}`, { method: 'DELETE' });
    this.torrents.delete(this.cacheKey(instance, torrent.hash));
    this.torrents.delete(this.cacheKey(instance, torrent.id as string));
    this.preloads.delete(this.cacheKey(instance, torrent.hash));
  }

  private static async patchResource<T = unknown>(instance: TorstInstance, path: string, patch: object): Promise<T> {
    const { etag } = await this.request(instance, path, { needsResponseHeaders: true });
    if (!etag) throw new TorstApiError('Torst did not expose the resource ETag', 0);
    return (await this.request<T>(instance, path, {
      body: JSON.stringify(patch),
      headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
      method: 'PATCH',
    })).data;
  }

  public static async updateTorrent(instance: TorstInstance, hash: string, update: TorrentUpdate): Promise<Torrent> {
    const torrent = await this.findTorrent(instance, hash);
    await this.patchResource(instance, `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}/configuration`, {
      storage_mode: update.storage === 'file' ? 'disk' : 'memory',
    });
    return this.getTorrent(instance, hash);
  }

  public static async getSettings(instance: TorstInstance): Promise<TorstSettings> {
    return (await this.request<TorstSettings>(instance, '/api/v1/settings')).data;
  }

  public static async getProfiles(instance: TorstInstance): Promise<TorstProfile[]> {
    return this.collectPages<TorstProfile>(instance, '/api/v1/profiles?page_size=200');
  }

  public static async createProfile(instance: TorstInstance, name: string): Promise<TorstProfile> {
    return (await this.request<TorstProfile>(instance, '/api/v1/profiles', {
      body: JSON.stringify({ name }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })).data;
  }

  public static async renameProfile(instance: TorstInstance, profileId: string, name: string): Promise<TorstProfile> {
    const path = `/api/v1/profiles/${encodeURIComponent(profileId)}`;
    return this.patchResource<TorstProfile>(instance, path, { name });
  }

  public static async getProfileAvatar(instance: TorstInstance, profileId: string): Promise<Blob> {
    return (await this.request<Blob>(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}/avatar`, { responseType: 'blob' })).data;
  }

  public static async deleteProfile(instance: TorstInstance, profileId: string): Promise<void> {
    await this.request(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
  }

  public static async getTorrentProgress(instance: TorstInstance, profileId: string, hash: string): Promise<FileProgress[]> {
    const torrent = await this.findTorrent(instance, hash);
    return this.collectPages<FileProgress>(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}/torrents/${encodeURIComponent(torrent.id as string)}/progress?page_size=200`);
  }

  public static async saveFileProgress(instance: TorstInstance, profileId: string, hash: string, fileId: string, progress: ProgressUpdate): Promise<FileProgress> {
    const torrent = await this.findTorrent(instance, hash);
    return (await this.request<FileProgress>(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}/torrents/${encodeURIComponent(torrent.id as string)}/progress/${encodeURIComponent(fileId)}`, {
      body: JSON.stringify(progress),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    })).data;
  }

  public static async getUpNext(instance: TorstInstance, profileId: string): Promise<UpNextEntry[]> {
    const entries = await this.collectPages<{
      file: TorstFile,
      id: string,
      progress: FileProgress | null,
      reason: string,
      torrent: TorstTorrent
    }>(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}/up-next?page_size=200`, true);
    const token = entries.some(entry => entry.torrent.poster) ? await AuthManager.getPlaybackToken(instance) : '';
    return entries.map(entry => {
      const torrent = this.rememberTorrent(instance, entry.torrent);
      return {
        file: { fileId: entry.file.id, length: entry.file.size_bytes, name: entry.file.path[entry.file.path.length - 1], path: entry.file.path.join('/') },
        id: entry.id,
        progress: entry.progress ? { ...entry.progress } : null,
        reason: entry.reason,
        torrent: { ...torrent, files: torrent.files.map(file => ({ ...file })), poster: torrent.poster && token ? `${torrent.poster}?token=${encodeURIComponent(token)}` : torrent.poster },
      };
    });
  }

  public static async dismissUpNext(instance: TorstInstance, profileId: string, entryId: string): Promise<void> {
    await this.request(instance, `/api/v1/profiles/${encodeURIComponent(profileId)}/up-next/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
  }

  public static async updateSettings(instance: TorstInstance, settings: TorstSettings): Promise<void> {
    await this.patchResource(instance, '/api/v1/settings', settings);
  }

  private static async fileResource(instance: TorstInstance, hash: string, identifier: { index?: number, path?: string }): Promise<{ file: TorrentFile, path: string }> {
    let torrent = await this.findTorrent(instance, hash);
    if (!torrent.files.length) torrent = await this.getTorrent(instance, hash);
    const file = identifier.index !== undefined ? torrent.files[identifier.index] : torrent.files.find(item => item.path === identifier.path);
    if (!file?.fileId) throw new TorstApiError('Torst file is not available', 404);
    return { file, path: `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}/files/${encodeURIComponent(file.fileId)}` };
  }

  public static async startPreload(instance: TorstInstance, hash: string, request: PreloadRequest): Promise<PreloadResponse> {
    return this.queuePreload(instance, hash, request);
  }

  private static async queuePreload(instance: TorstInstance, hash: string, request: PreloadRequest, expectedPreloadId?: string): Promise<PreloadResponse> {
    const original = { ...instance };
    const instanceKey = `${instance.id}\u0001${instance.url}`;
    const pending = this.preloadStarts.get(instanceKey) || Promise.resolve();
    const start = pending.then(() => {
      if (expectedPreloadId && this.preloads.get(this.cacheKey(instance, hash))?.id !== expectedPreloadId) {
        return { status: 'evicted' as const };
      }
      this.ensureInstanceUnchanged(instance, original);
      return this.createPreload(instance, hash, request);
    });
    const settled = start.then(() => {}, () => {});
    this.preloadStarts.set(instanceKey, settled);
    try {
      return await start;
    } finally {
      if (this.preloadStarts.get(instanceKey) === settled) this.preloadStarts.delete(instanceKey);
    }
  }

  private static async createPreload(instance: TorstInstance, hash: string, request: PreloadRequest): Promise<PreloadResponse> {
    for (const [key, preload] of this.preloads) {
      if (preload.instance.id === instance.id && preload.instance.url === instance.url) {
        await this.deletePreload(instance, key, preload);
      }
    }
    const { file, path } = await this.fileResource(instance, hash, { index: request.file_index, path: request.file_path });
    const torrent = await this.findTorrent(instance, hash);
    if (torrent.isPaused) {
      await this.patchResource(instance, `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}/configuration`, { desired_state: 'started' });
      torrent.isPaused = false;
    }
    const fraction = request.playbackFraction;
    const offsetBytes = fraction !== undefined && Number.isFinite(fraction) && fraction > 0 && fraction < 1 && file.length > 0
      ? Math.min(file.length - 1, Math.floor(file.length * fraction))
      : undefined;
    let data: TorstPreload;
    try {
      data = (await this.request<TorstPreload>(instance, `${path}/preloads`, {
        body: JSON.stringify({ offset_bytes: offsetBytes, ttl_seconds: 300 }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })).data;
    } catch (error) {
      // Each POST creates a new preload, even if the preceding reply was lost.
      if (isNetworkError(error) || error instanceof SyntaxError) throw new PreloadStartUnconfirmedError();
      throw error;
    }
    if (!data || typeof data.id !== 'string' || !data.id) throw new PreloadStartUnconfirmedError();
    this.preloads.set(this.cacheKey(instance, hash), {
      id: data.id,
      instance: { ...instance },
      path: `${path}/preloads/${encodeURIComponent(data.id)}`,
      request: { ...request },
    });
    return this.preloadStatus(instance, hash, data);
  }

  private static async preloadStatus(instance: TorstInstance, hash: string, preload: TorstPreload): Promise<PreloadResponse> {
    const torrent = await this.findTorrent(instance, hash);
    const stats = preload.state === 'ready' ? undefined
      : await this.request<TorstStatistics>(instance, `/api/v1/torrents/${encodeURIComponent(torrent.id as string)}/statistics`, { timeoutMs: 1500 }).then(result => result.data).catch(() => undefined);
    return {
      active_peers: stats?.peer_count,
      completed_bytes: preload.completed_bytes,
      download_rate: stats?.download_rate_bytes_per_second,
      preloadId: preload.id,
      status: preload.state === 'expired' ? 'evicted' : preload.state === 'downloading' ? 'preloading' : preload.state,
      target_bytes: preload.target_bytes,
      total_peers: stats?.peer_count,
    };
  }

  public static async getPreload(instance: TorstInstance, hash: string, preloadId?: string): Promise<PreloadResponse> {
    const key = this.cacheKey(instance, hash);
    const preload = this.preloads.get(key);
    if (!preload) return { status: preloadId ? 'evicted' : 'idle' };
    if (preloadId && preload.id !== preloadId) return { status: 'evicted' };
    const { data } = await this.request<TorstPreload>(instance, preload.path);
    if (this.preloads.get(key) !== preload) return { status: 'evicted' };
    if (data.state === 'expired') return this.queuePreload(instance, hash, preload.request, preload.id);
    return this.preloadStatus(instance, hash, data);
  }

  private static async deletePreload(instance: TorstInstance, key: string, preload: ActivePreload): Promise<void> {
    try {
      await this.request(instance, preload.path, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof TorstApiError) || error.status !== 404) throw error;
    }
    if (this.preloads.get(key) === preload) this.preloads.delete(key);
  }

  public static async cancelPreload(instance: TorstInstance, hash: string, preloadId?: string): Promise<void> {
    const key = this.cacheKey(instance, hash);
    const preload = this.preloads.get(key);
    if (!preload || (preloadId && preload.id !== preloadId)) return;
    await this.deletePreload(instance, key, preload);
  }

  public static async getStreamUrl(instance: TorstInstance, hash: string, identifier: { index?: number, path?: string }): Promise<string> {
    const { path } = await this.fileResource(instance, hash, identifier);
    const token = await AuthManager.getPlaybackToken(instance);
    return `${instance.url.replace(/\/+$/, '')}${path}/content${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }

  public static resetForTesting(): void {
    this.pages.clear();
    this.torrents.clear();
    this.preloads.clear();
    this.preloadStarts.clear();
  }
}
