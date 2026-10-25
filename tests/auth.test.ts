// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { AuthenticationError, AuthManager } from '../src/api/auth';
import { TorstInstance } from '../src/types/torst';

function createInstance(): TorstInstance {
  return { authType: 'bearer', id: 'test', name: 'Test', password: 'secret password', url: 'http://localhost:8080' };
}

describe('Torst authentication', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('does not authenticate instances with no password protection', async () => {
    const instance = createInstance();
    instance.authType = 'none';
    globalThis.fetch = async () => { throw new Error('Unexpected login'); };
    assert.equal((await AuthManager.getAuthHeaders(instance)).Authorization, undefined);
    assert.equal(await AuthManager.getPlaybackToken(instance), '');
  });

  it('signs in with a JSON password and client name and caches the returned secret', async () => {
    const instance = createInstance();
    let calls = 0;
    globalThis.fetch = async (input, options) => {
      calls++;
      assert.equal(String(input), `${instance.url}/api/v1/access-tokens`);
      assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(String(options.body)), { expires_in_seconds: 86400, name: 'Torst Lampa', password: 'secret password' });
      return new Response(JSON.stringify({ expires_at: null, secret: 'tpa_secret' }), { status: 201 });
    };
    assert.equal((await AuthManager.getAuthHeaders(instance)).Authorization, 'Bearer tpa_secret');
    assert.equal(await AuthManager.ensureAccessToken(instance), 'tpa_secret');
    assert.equal(instance.accessTokenExpiresAtMs, Infinity);
    assert.equal(calls, 1);
  });

  it('refreshes an expired access token and applies the expiration buffer', async () => {
    const instance = createInstance();
    instance.accessToken = 'expired';
    instance.accessTokenExpiresAtMs = 1;
    const expiresAt = Date.now() + 3600000;
    globalThis.fetch = async () => new Response(JSON.stringify({ expires_at: new Date(expiresAt).toISOString(), secret: 'fresh' }));
    assert.equal(await AuthManager.ensureAccessToken(instance), 'fresh');
    assert.equal(instance.accessTokenExpiresAtMs, expiresAt - 60000);
  });

  it('rejects missing credentials without a request and reports login refusal', async () => {
    const instance = createInstance();
    delete instance.password;
    await assert.rejects(AuthManager.loginBearer(instance), AuthenticationError);
    instance.password = 'wrong password';
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(AuthManager.loginBearer(instance), (error: unknown) => error instanceof AuthenticationError && error.status === 401);
  });

  it('does not cache tokens if credentials changed during login', async () => {
    const instance = createInstance();
    globalThis.fetch = async () => {
      instance.password = 'changed';
      return new Response(JSON.stringify({ expires_at: null, secret: 'stale' }));
    };
    await assert.rejects(AuthManager.loginBearer(instance), /settings changed/);
    assert.equal(instance.accessToken, undefined);
  });

  it('issues and caches a playback token using the access token', async () => {
    const instance = createInstance();
    instance.accessToken = 'api';
    instance.accessTokenExpiresAtMs = Infinity;
    let calls = 0;
    globalThis.fetch = async (input, options) => {
      calls++;
      assert.equal(String(input), `${instance.url}/api/v1/playback-tokens`);
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer api');
      assert.deepEqual(JSON.parse(String(options?.body)), {});
      return new Response(JSON.stringify({ expires_at: new Date(Date.now() + 3600000).toISOString(), token: 'tpp_playback' }));
    };
    assert.equal(await AuthManager.getPlaybackToken(instance), 'tpp_playback');
    assert.equal(await AuthManager.getPlaybackToken(instance), 'tpp_playback');
    assert.equal(calls, 1);
    AuthManager.invalidateTokens(instance);
    assert.equal(instance.accessToken, undefined);
    assert.equal(instance.playbackToken, undefined);
  });

  it('retries a refused playback token once after signing in again', async () => {
    const instance = createInstance();
    instance.accessToken = 'expired';
    instance.accessTokenExpiresAtMs = Infinity;
    let calls = 0;
    globalThis.fetch = async input => {
      calls++;
      if (calls === 1) return new Response(null, { status: 401 });
      if (String(input).endsWith('/access-tokens')) return new Response(JSON.stringify({ expires_at: null, secret: 'fresh' }));
      return new Response(JSON.stringify({ expires_at: new Date(Date.now() + 3600000).toISOString(), token: 'playback' }));
    };
    assert.equal(await AuthManager.getPlaybackToken(instance), 'playback');
    assert.equal(calls, 3);
  });
  it('shares concurrent access and playback token requests', async () => {
    const instance = createInstance();
    const paths: string[] = [];
    globalThis.fetch = async input => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      await new Promise(resolve => setImmediate(resolve));
      return new Response(JSON.stringify(path.endsWith('/access-tokens')
        ? { expires_at: null, secret: 'api' }
        : { expires_at: new Date(Date.now() + 3600000).toISOString(), token: 'playback' }));
    };
    const results = await Promise.all([
      AuthManager.getAuthHeaders(instance), AuthManager.getAuthHeaders(instance),
      AuthManager.getPlaybackToken(instance), AuthManager.getPlaybackToken(instance),
    ]);
    assert.deepEqual(paths, ['/api/v1/access-tokens', '/api/v1/playback-tokens']);
    assert.deepEqual(results.slice(2), ['playback', 'playback']);
  });

  it('does not restore invalidated credentials when an old request finishes', async () => {
    const instance = createInstance();
    let finish: (response: Response) => void = () => {};
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = AuthManager.ensureAccessToken(instance);
    AuthManager.invalidateTokens(instance);
    finish(new Response(JSON.stringify({ expires_at: null, secret: 'stale' })));
    await assert.rejects(pending, /settings changed/);
    assert.equal(instance.accessToken, undefined);
  });

  it('does not share a login with credentials edited while the old request is pending', async () => {
    const instance = createInstance();
    const pending: Array<(response: Response) => void> = [];
    globalThis.fetch = () => new Promise(resolve => { pending.push(resolve); });
    const oldLogin = AuthManager.ensureAccessToken(instance);
    instance.password = 'new password';
    const newLogin = AuthManager.ensureAccessToken(instance);
    assert.equal(pending.length, 2);
    pending[1](new Response(JSON.stringify({ expires_at: null, secret: 'fresh' })));
    assert.equal(await newLogin, 'fresh');
    pending[0](new Response(JSON.stringify({ expires_at: null, secret: 'stale' })));
    await assert.rejects(oldLogin, /settings changed/);
    assert.equal(instance.accessToken, 'fresh');
  });

  it('allows a new login after a failed shared request', async () => {
    const instance = createInstance();
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? new Response(null, { status: 503 })
      : new Response(JSON.stringify({ expires_at: null, secret: 'fresh' }));
    await assert.rejects(AuthManager.ensureAccessToken(instance), AuthenticationError);
    assert.equal(await AuthManager.ensureAccessToken(instance), 'fresh');
    assert.equal(calls, 2);
  });

  for (const response of [{ expires_at: null }, { expires_at: 'invalid', secret: 'api' }, { expires_at: '2000-01-01', secret: 'api' }]) {
    it(`rejects an invalid access token (${JSON.stringify(response)})`, async () => {
      const instance = createInstance();
      globalThis.fetch = async () => new Response(JSON.stringify(response));
      await assert.rejects(AuthManager.ensureAccessToken(instance), AuthenticationError);
      assert.equal(instance.accessToken, undefined);
    });
  }

  for (const response of [{ expires_at: 'invalid', token: 'playback' }, { expires_at: '2099-01-01', token: '' }]) {
    it(`rejects an invalid playback token (${JSON.stringify(response)})`, async () => {
      const instance = createInstance();
      instance.accessToken = 'api';
      instance.accessTokenExpiresAtMs = Infinity;
      globalThis.fetch = async () => new Response(JSON.stringify(response));
      await assert.rejects(AuthManager.getPlaybackToken(instance), AuthenticationError);
      assert.equal(instance.playbackToken, undefined);
    });
  }

  it('caches a valid short-lived playback token instead of expiring it immediately', async () => {
    const instance = createInstance();
    instance.accessToken = 'api';
    instance.accessTokenExpiresAtMs = Infinity;
    const expiresAt = Date.now() + 60000;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ expires_at: new Date(expiresAt).toISOString(), token: 'short-lived' }));
    };
    assert.equal(await AuthManager.getPlaybackToken(instance), 'short-lived');
    assert.equal(await AuthManager.getPlaybackToken(instance), 'short-lived');
    assert.equal(calls, 1);
    assert.ok((instance.playbackTokenExpiresAtMs || 0) > Date.now());
    assert.ok((instance.playbackTokenExpiresAtMs || 0) < expiresAt);
  });

});
