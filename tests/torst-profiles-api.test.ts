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
        return json({ id: 'prf_sam', kind: 'person', name: 'Sam' }, 201);
      }
      return url.searchParams.has('cursor')
        ? json({ items: [{ id: 'prf_sam', kind: 'person', name: 'Sam' }], links: {} })
        : json({ items: [{ id: 'prf_alex', kind: 'person', name: 'Alex' }], links: { next: '/api/v1/profiles?cursor=next' } });
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
        return json({ id: 'prf_one', kind: 'person', name: 'Normalized Name' });
      }
      assert.equal(methods.length, 1, 'a successful rename must not require another read');
      return json({ id: 'prf_one', kind: 'person', name: 'Alex' }, 200, { ETag: '"profile-v1"' });
    };
    assert.equal((await TorstApi.renameProfile(instance, 'prf_one', 'Sam')).name, 'Normalized Name');
    assert.deepEqual(methods, ['GET', 'PATCH']);
  });

  it('preserves a device-profile deletion rejection', async () => {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.method, 'DELETE');
      return json({ detail: 'The device profile cannot be deleted' }, 409);
    };
    await assert.rejects(TorstApi.deleteProfile(instance, 'prf_device'), (error: unknown) => error instanceof TorstApiError && error.status === 409);
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

  it('follows title progress cursors and saves the associated opaque file and torrent IDs', async () => {
    const title = { ...progress, title_key: 'tmdb-tv-123-s1e1', torrent_id: 'trr_one' };
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/torrents') return json({ items: [torrent], links: {} });
      if (options?.method === 'PUT') {
        assert.equal(url.pathname, '/api/v1/profiles/prf_one/title-progress/tmdb-tv-123-s1e1');
        assert.equal((options.headers as Record<string, string>)['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(String(options.body)), { duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, torrent_id: 'trr_one', viewed: false });
        return json(title, 201);
      }
      assert.equal(url.pathname, '/api/v1/profiles/prf_one/title-progress');
      if (url.searchParams.has('cursor')) return json({ items: [title], links: {} });
      assert.equal(url.searchParams.get('title_key_prefix'), 'tmdb-tv-123-');
      return json({ items: [], links: { next: '/api/v1/profiles/prf_one/title-progress?cursor=next' } });
    };
    assert.deepEqual(await TorstApi.getTitleProgress(instance, 'prf_one', 'tmdb-tv-123-'), [title]);
    assert.deepEqual(await TorstApi.saveTitleProgress(instance, 'prf_one', 'tmdb-tv-123-s1e1', hash, 'fil_one', { duration_seconds: 400, position_seconds: 100, viewed: false }), title);
  });

  it('reads one movie title directly without collecting neighboring title keys', async () => {
    const title = { ...progress, title_key: 'tmdb-movie-123', torrent_id: 'trr_one' };
    globalThis.fetch = async input => {
      assert.equal(new URL(String(input)).pathname, '/api/v1/profiles/prf_one/title-progress/tmdb-movie-123');
      return json(title);
    };
    assert.deepEqual(await TorstApi.getTitleProgress(instance, 'prf_one', title.title_key), [title]);
    globalThis.fetch = async () => json({ detail: 'No progress for this title' }, 404);
    assert.deepEqual(await TorstApi.getTitleProgress(instance, 'prf_one', title.title_key), []);
    globalThis.fetch = async () => json({ detail: 'Unavailable' }, 503);
    await assert.rejects(TorstApi.getTitleProgress(instance, 'prf_one', title.title_key), (error: unknown) => error instanceof TorstApiError && error.status === 503);
  });

  it('creates, reads, and deletes a viewing of an opaque file without a request body', async () => {
    const filePath = '/api/v1/torrents/trr_one/files/fil_one';
    const viewing = { duration_seconds: null, id: 'vwg_one', links: { self: `${filePath}/viewings/vwg_one` }, position_seconds: null, streaming: false };
    const methods: string[] = [];
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/torrents') return json({ items: [torrent], links: {} });
      if (url.pathname === '/api/v1/torrents/trr_one') return json({ ...torrent, file_count: 1 });
      if (url.pathname === '/api/v1/torrents/trr_one/files') return json({ items: [{ id: 'fil_one', path: ['Sintel.mkv'], size_bytes: 100 }], links: {} });
      methods.push(options?.method || 'GET');
      assert.equal(options?.body, undefined);
      if (options?.method === 'POST') {
        assert.equal(url.pathname, `${filePath}/viewings`);
        return json(viewing, 201);
      }
      assert.equal(url.pathname, viewing.links.self);
      return options?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ ...viewing, duration_seconds: 400, position_seconds: 140 });
    };
    const created = await TorstApi.createFileViewing(instance, hash, { index: 0 });
    assert.deepEqual(created, viewing);
    assert.equal((await TorstApi.getFileViewing(instance, created)).position_seconds, 140);
    await TorstApi.deleteFileViewing(instance, created);
    assert.deepEqual(methods, ['POST', 'GET', 'DELETE']);
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
