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

  public static invalidateTokens(instance: TorstInstance): void {
    this.generations.set(instance, (this.generations.get(instance) || 0) + 1);
    this.accessRequests.delete(instance);
    this.playbackRequests.delete(instance);
    delete instance.accessToken;
    delete instance.accessTokenExpiresAtMs;
    delete instance.playbackToken;
    delete instance.playbackTokenExpiresAtMs;
  }

  public static rejectAccessToken(instance: TorstInstance, authorization?: string): void {
    if (!instance.accessToken || authorization !== `Bearer ${instance.accessToken}`) return;
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

  private static async shareRequest(instance: TorstInstance, requests: WeakMap<TorstInstance, PendingTokenRequest>, request: () => Promise<string>): Promise<string> {
    const generation = this.generations.get(instance) || 0;
    const pending = requests.get(instance);
    if (pending && pending.generation === generation && this.hasSameAuthentication(instance, pending.instance)) {
      return pending.promise;
    }
    const entry = { generation, instance: { ...instance }, promise: request() };
    requests.set(instance, entry);
    try {
      return await entry.promise;
    } finally {
      if (requests.get(instance) === entry) requests.delete(instance);
    }
  }

  public static async loginBearer(instance: TorstInstance): Promise<string> {
    return this.shareRequest(instance, this.accessRequests, () => this.requestAccessToken(instance));
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

  public static async getPlaybackToken(instance: TorstInstance): Promise<string> {
    if (instance.authType === 'none') return '';
    if (instance.playbackToken && instance.playbackTokenExpiresAtMs && Date.now() < instance.playbackTokenExpiresAtMs) {
      return instance.playbackToken;
    }
    return this.shareRequest(instance, this.playbackRequests, () => this.requestPlaybackToken(instance));
  }

  private static async requestPlaybackToken(instance: TorstInstance, shouldRetry = true): Promise<string> {
    const original = { ...instance };
    const generation = this.generations.get(instance) || 0;
    const authHeaders = await this.getAuthHeaders(instance);
    this.ensureAuthenticationUnchanged(instance, original, generation);
    const response = await requestHttp(`${instance.url.replace(/\/+$/, '')}/api/v1/playback-tokens`, {
      body: '{}',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    this.ensureAuthenticationUnchanged(instance, original, generation);
    if (response.status === 401 && shouldRetry) {
      this.rejectAccessToken(instance, authHeaders['Authorization']);
      return this.requestPlaybackToken(instance, false);
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
    instance.playbackToken = token.token;
    instance.playbackTokenExpiresAtMs = this.expirationWithBuffer(expiresAtMs);
    return token.token;
  }
}
