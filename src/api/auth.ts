// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { AccessTokenResponse, PlaybackTokenResponse, TorstInstance } from '../types/torst';
import { requestHttp } from './http-client';

interface PendingTokenRequest {
  generation: number,
  instance: TorstInstance,
  promise: Promise<string>
}

interface ScopedPlaybackToken {
  expiresAtMs: number,
  token: string
}

const SCOPED_PLAYBACK_TOKEN_LIMIT = 64;

export class AuthenticationError extends Error {
  public status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthenticationError';
    this.status = status;
  }
}

export class AuthManager {
  private static accessRequests = new WeakMap<TorstInstance, PendingTokenRequest>();
  private static generations = new WeakMap<TorstInstance, number>();
  private static playbackRequests = new WeakMap<TorstInstance, PendingTokenRequest>();
  private static scopedPlaybackRequests = new WeakMap<TorstInstance, Map<string, PendingTokenRequest>>();
  private static scopedPlaybackTokens = new WeakMap<TorstInstance, Map<string, ScopedPlaybackToken>>();

  public static invalidateTokens(instance: TorstInstance): void {
    this.generations.set(instance, (this.generations.get(instance) || 0) + 1);
    this.accessRequests.delete(instance);
    this.playbackRequests.delete(instance);
    this.scopedPlaybackRequests.delete(instance);
    this.scopedPlaybackTokens.delete(instance);
    delete instance.accessToken;
    delete instance.accessTokenExpiresAtMs;
    delete instance.playbackToken;
    delete instance.playbackTokenExpiresAtMs;
  }

  public static rejectAccessToken(instance: TorstInstance, authorization?: string): void {
    if (!instance.accessToken || authorization !== `Bearer ${instance.accessToken}`) return;
    this.scopedPlaybackTokens.delete(instance);
    delete instance.accessToken;
    delete instance.accessTokenExpiresAtMs;
    delete instance.playbackToken;
    delete instance.playbackTokenExpiresAtMs;
  }

  private static hasSameAuthentication(instance: TorstInstance, original: TorstInstance): boolean {
    return instance.authType === original.authType
      && instance.password === original.password
      && instance.url === original.url;
  }

  private static ensureAuthenticationUnchanged(instance: TorstInstance, original: TorstInstance, generation: number): void {
    if (!this.hasSameAuthentication(instance, original) || (this.generations.get(instance) || 0) !== generation) {
      throw new AuthenticationError('Instance authentication settings changed; retry the request');
    }
  }

  private static expirationWithBuffer(expiresAtMs: number): number {
    return expiresAtMs - Math.min(60000, (expiresAtMs - Date.now()) / 2);
  }

  private static async shareRequest<K>(
    instance: TorstInstance,
    requests: { delete(key: K): unknown, get(key: K): PendingTokenRequest | undefined, set(key: K, value: PendingTokenRequest): unknown },
    key: K,
    request: () => Promise<string>
  ): Promise<string> {
    const generation = this.generations.get(instance) || 0;
    const pending = requests.get(key);
    if (pending && pending.generation === generation && this.hasSameAuthentication(instance, pending.instance)) {
      return pending.promise;
    }
    const entry = { generation, instance: { ...instance }, promise: request() };
    requests.set(key, entry);
    try {
      return await entry.promise;
    } finally {
      if (requests.get(key) === entry) requests.delete(key);
    }
  }

  public static async loginBearer(instance: TorstInstance): Promise<string> {
    return this.shareRequest(instance, this.accessRequests, instance, () => this.requestAccessToken(instance));
  }

  private static async requestAccessToken(instance: TorstInstance): Promise<string> {
    if (!instance.password) throw new AuthenticationError('Password required for Bearer authentication');
    const original = { ...instance };
    const generation = this.generations.get(instance) || 0;
    const response = await requestHttp(`${instance.url.replace(/\/+$/, '')}/api/v1/access-tokens`, {
      body: JSON.stringify({ expires_in_seconds: 86400, name: 'Torst Lampa', password: instance.password }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new AuthenticationError(`Bearer auth failed (${response.status}): ${response.statusText || 'Unauthorized'}`, response.status);
    }
    const token = await response.json() as AccessTokenResponse;
    this.ensureAuthenticationUnchanged(instance, original, generation);
    if (!token || typeof token.secret !== 'string' || !token.secret) throw new AuthenticationError('Torst returned an invalid access token');
    const expiresAtMs = token.expires_at === null ? Infinity : Date.parse(token.expires_at);
    if (!(expiresAtMs > Date.now())) {
      throw new AuthenticationError('Torst returned an invalid access token');
    }
    instance.accessToken = token.secret;
    instance.accessTokenExpiresAtMs = this.expirationWithBuffer(expiresAtMs);
    return token.secret;
  }

  public static async ensureAccessToken(instance: TorstInstance): Promise<string> {
    if (instance.accessToken && instance.accessTokenExpiresAtMs && Date.now() < instance.accessTokenExpiresAtMs) {
      return instance.accessToken;
    }
    return this.loginBearer(instance);
  }

  public static async getAuthHeaders(instance: TorstInstance): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
    if (instance.authType === 'bearer') headers['Authorization'] = `Bearer ${await this.ensureAccessToken(instance)}`;
    return headers;
  }

  /**
   * Issues a token for media URLs. Without `torrentId` it allows every torrent and profile
   * avatars; with one, only that torrent's content and poster, so a URL handed to a player
   * cannot reach the rest of the library.
   */
  public static async getPlaybackToken(instance: TorstInstance, torrentId?: string): Promise<string> {
    if (instance.authType === 'none') return '';
    if (torrentId) return this.getScopedPlaybackToken(instance, torrentId);
    if (instance.playbackToken && instance.playbackTokenExpiresAtMs && Date.now() < instance.playbackTokenExpiresAtMs) {
      return instance.playbackToken;
    }
    return this.shareRequest(instance, this.playbackRequests, instance, async () => {
      const { expiresAtMs, token } = await this.requestPlaybackToken(instance);
      instance.playbackToken = token;
      instance.playbackTokenExpiresAtMs = expiresAtMs;
      return token;
    });
  }

  private static async getScopedPlaybackToken(instance: TorstInstance, torrentId: string): Promise<string> {
    const cached = this.scopedPlaybackTokens.get(instance)?.get(torrentId);
    if (cached && Date.now() < cached.expiresAtMs) return cached.token;
    let requests = this.scopedPlaybackRequests.get(instance);
    if (!requests) {
      requests = new Map();
      this.scopedPlaybackRequests.set(instance, requests);
    }
    const generation = this.generations.get(instance) || 0;
    return this.shareRequest(instance, requests, torrentId, async () => {
      const issued = await this.requestPlaybackToken(instance, torrentId);
      if ((this.generations.get(instance) || 0) !== generation) return issued.token;
      let tokens = this.scopedPlaybackTokens.get(instance);
      if (!tokens) {
        tokens = new Map();
        this.scopedPlaybackTokens.set(instance, tokens);
      }
      tokens.delete(torrentId);
      tokens.set(torrentId, issued);
      while (tokens.size > SCOPED_PLAYBACK_TOKEN_LIMIT) tokens.delete(tokens.keys().next().value as string);
      return issued.token;
    });
  }

  private static async requestPlaybackToken(instance: TorstInstance, torrentId?: string, shouldRetry = true): Promise<ScopedPlaybackToken> {
    const original = { ...instance };
    const generation = this.generations.get(instance) || 0;
    const authHeaders = await this.getAuthHeaders(instance);
    this.ensureAuthenticationUnchanged(instance, original, generation);
    const response = await requestHttp(`${instance.url.replace(/\/+$/, '')}/api/v1/playback-tokens`, {
      body: torrentId ? JSON.stringify({ torrent_id: torrentId }) : '{}',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    this.ensureAuthenticationUnchanged(instance, original, generation);
    if (response.status === 401 && shouldRetry) {
      this.rejectAccessToken(instance, authHeaders['Authorization']);
      return this.requestPlaybackToken(instance, torrentId, false);
    }
    if (!response.ok) {
      throw new AuthenticationError(`Failed to obtain playback token (${response.status}): ${response.statusText || 'Unauthorized'}`, response.status);
    }
    const token = await response.json() as PlaybackTokenResponse;
    this.ensureAuthenticationUnchanged(instance, original, generation);
    if (!token || typeof token.token !== 'string' || !token.token) throw new AuthenticationError('Torst returned an invalid playback token');
    const expiresAtMs = Date.parse(token.expires_at);
    if (!(expiresAtMs > Date.now())) {
      throw new AuthenticationError('Torst returned an invalid playback token');
    }
    return { expiresAtMs: this.expirationWithBuffer(expiresAtMs), token: token.token };
  }
}
