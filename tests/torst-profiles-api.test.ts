// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { TorstApi, TorstApiError } from '../src/api/torst';
import { TorstInstance } from '../src/types/torst';
import { createTorstTorrent } from './support/torst';

const instance: TorstInstance = { authType: 'none', id: 'one', name: 'One', url: 'http://torst.test' };
const hash = 'a'.repeat(40);
const torrent = createTorstTorrent({ files: [], hash, id: 'trr_one', name: 'Sintel', retention: 'persisted' });
const progress = { completion_ratio: 0.25, duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, updated_at: '2026-10-25T10:00:00Z', viewed: false, viewed_at: null };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers }, status });

describe('Torst profiles and progress API', () => {
  const originalFetch = globalThis.fetch;
  const originalLampa = (globalThis as any).Lampa;
  beforeEach(() => {
    TorstApi.resetForTesting();
    (globalThis as any).Lampa = {};
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).Lampa = originalLampa;
  });

  it('follows profile cursors and creates a profile with a JSON name', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (options?.method === 'POST') {
        assert.deepEqual(JSON.parse(String(options.body)), { name: 'Sam' });
        return json({ id: 'prf_sam', name: 'Sam' }, 201);
      }
      return url.searchParams.has('cursor')
        ? json({ items: [{ id: 'prf_sam', name: 'Sam' }], links: {} })
        : json({ items: [{ id: 'prf_alex', name: 'Alex' }], links: { next: '/api/v1/profiles?cursor=next' } });
    };
    assert.deepEqual((await TorstApi.getProfiles(instance)).map(profile => profile.id), ['prf_alex', 'prf_sam']);
    assert.equal((await TorstApi.createProfile(instance, 'Sam')).id, 'prf_sam');
  });

  it('renames against the profile ETag and uses the normalized PATCH response', async () => {
    const methods: string[] = [];
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(String(input)).pathname, '/api/v1/profiles/prf_one');
      methods.push(options?.method || 'GET');
      if (options?.method === 'PATCH') {
        assert.equal((options.headers as Record<string, string>)['If-Match'], '"profile-v1"');
        assert.equal((options.headers as Record<string, string>)['Content-Type'], 'application/merge-patch+json');
        assert.deepEqual(JSON.parse(String(options.body)), { name: 'Sam' });
        return json({ id: 'prf_one', name: 'Normalized Name' });
      }
      assert.equal(methods.length, 1, 'a successful rename must not require another read');
      return json({ id: 'prf_one', name: 'Alex' }, 200, { ETag: '"profile-v1"' });
    };
    assert.equal((await TorstApi.renameProfile(instance, 'prf_one', 'Sam')).name, 'Normalized Name');
    assert.deepEqual(methods, ['GET', 'PATCH']);
  });

  it('preserves a last-profile deletion rejection', async () => {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.method, 'DELETE');
      return json({ detail: 'Cannot delete the last profile' }, 409);
    };
    await assert.rejects(TorstApi.deleteProfile(instance, 'prf_last'), (error: unknown) => error instanceof TorstApiError && error.status === 409);
  });

  it('reads and saves seconds-based file progress through opaque resource IDs', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/torrents') {
        assert.equal(url.searchParams.get('info_hash'), hash);
        return json({ items: [torrent], links: {} });
      }
      if (options?.method === 'PUT') {
        assert.equal(url.pathname, '/api/v1/profiles/prf_one/torrents/trr_one/progress/fil_one');
        assert.equal((options.headers as Record<string, string>)['If-Match'], undefined);
        assert.deepEqual(JSON.parse(String(options.body)), { duration_seconds: 400, position_seconds: 100, viewed: false });
        return json(progress);
      }
      assert.equal(url.pathname, '/api/v1/profiles/prf_one/torrents/trr_one/progress');
      return json({ items: [progress], links: {} });
    };
    assert.deepEqual(await TorstApi.getTorrentProgress(instance, 'prf_one', hash), [progress]);
    assert.deepEqual(await TorstApi.saveFileProgress(instance, 'prf_one', hash, 'fil_one', { duration_seconds: 400, position_seconds: 100, viewed: false }), progress);
  });

  it('maps Up Next files and isolates cached progress from callers', async () => {
    globalThis.fetch = async (_input, options) => {
      if ((options?.headers as Record<string, string>)['If-None-Match']) return new Response(null, { status: 304 });
      return json({ items: [{ file: { id: 'fil_one', path: ['Season 1', 'Show.S01E01.mkv'], size_bytes: 1024 }, id: 'upn_one', progress, reason: 'resume', torrent }], links: {} }, 200, { ETag: '"up-next"' });
    };
    const first = await TorstApi.getUpNext(instance, 'prf_one');
    assert.equal(first[0].file.path, 'Season 1/Show.S01E01.mkv');
    assert.equal(first[0].file.fileId, 'fil_one');
    first[0].progress!.position_seconds = 333;
    first[0].torrent.name = 'Changed';
    const second = await TorstApi.getUpNext(instance, 'prf_one');
    assert.equal(second[0].progress?.position_seconds, 100);
    assert.equal(second[0].torrent.name, 'Sintel');
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(String(input)).pathname, '/api/v1/profiles/prf_one/up-next/upn_one');
      assert.equal(options?.method, 'DELETE');
      return new Response(null, { status: 204 });
    };
    await TorstApi.dismissUpNext(instance, 'prf_one', 'upn_one');
  });

  it('loads avatar bytes with an authorization header rather than a token URL', async () => {
    const authenticated = { ...instance, accessToken: 'access-secret', accessTokenExpiresAtMs: Infinity, authType: 'bearer' as const };
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), 'http://torst.test/api/v1/profiles/prf_one/avatar');
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer access-secret');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    };
    const blob = await TorstApi.getProfileAvatar(authenticated, 'prf_one');
    assert.equal(blob.type, 'image/png');
    assert.equal(blob.size, 3);
  });
});
