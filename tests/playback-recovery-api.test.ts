// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { TorrentRecoverySource, TorstInstance } from '../src/types/torst';
import { createTorstTorrent } from './support/torst';

const hash = 'a'.repeat(40);
const instance: TorstInstance = { accessToken: 'api-secret', accessTokenExpiresAtMs: Infinity, authType: 'bearer', id: 'one', name: 'One', playbackToken: 'playback-secret', playbackTokenExpiresAtMs: Infinity, url: 'http://torst.test' };
const original = createTorstTorrent({ files: [{ length: 100, name: 'Sintel.mkv', path: 'Sintel.mkv' }], hash, id: 'trr_old', name: 'Sintel', retention: 'temporary' });
const replacement = { ...original, id: 'trr_new' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function source(retention: 'temporary' | 'persisted' = 'temporary'): TorrentRecoverySource {
  return { metainfo: new Blob(['private tracker metainfo'], { type: 'application/x-bittorrent' }), torrent: { files: [], hash, id: 'trr_old', name: 'Sintel', retention, storage: retention === 'temporary' ? 'memory' : 'file', title: 'Sintel', total_size: 100 } };
}

describe('Torst playback recovery API', () => {
  const originalFetch = globalThis.fetch;
  const originalLampa = (globalThis as any).Lampa;
  beforeEach(() => { TorstApi.resetForTesting(); (globalThis as any).Lampa = {}; });
  afterEach(() => { globalThis.fetch = originalFetch; (globalThis as any).Lampa = originalLampa; });

  it('captures authenticated metainfo without putting access tokens in the URL', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.has('token'), false);
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer api-secret');
      if (url.pathname === '/api/v1/torrents') return json({ items: [original], links: {} });
      assert.equal(url.pathname, '/api/v1/torrents/trr_old/metainfo');
      return new Response('private tracker metainfo', { headers: { 'Content-Type': 'application/x-bittorrent' } });
    };
    const captured = await TorstApi.captureTorrentRecovery(instance, hash);
    assert.equal(await captured.metainfo.text(), 'private tracker metainfo');
    assert.equal(captured.torrent.retention, 'temporary');
  });

  for (const retention of ['temporary', 'persisted'] as const) {
    it(`recreates a missing ${retention} torrent with its retention and selects the file by opaque ID`, async () => {
      let uploaded = false;
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v1/playback-tokens') {
          assert.deepEqual(JSON.parse(String(options?.body)), { torrent_id: 'trr_new' });
          return json({ expires_at: '2999-01-01T00:00:00Z', token: 'torrent-secret', torrent_id: 'trr_new' }, 201);
        }
        if (options?.method === 'POST') {
          assert.ok(options.body instanceof FormData);
          assert.equal(options.body.get('retention'), retention);
          assert.equal(options.body.get('storage_mode'), retention === 'temporary' ? 'memory' : 'disk');
          assert.equal(options.body.get('title'), retention === 'temporary' ? null : 'Sintel');
          assert.equal(await (options.body.get('metainfo') as Blob).text(), 'private tracker metainfo');
          uploaded = true;
          return json({ ...replacement, retention }, 201);
        }
        if (url.pathname === '/api/v1/torrents') return json({ items: uploaded ? [{ ...replacement, retention }] : [], links: {} });
        if (url.pathname === '/api/v1/torrents/trr_new') return json({ ...replacement, retention });
        if (url.pathname === '/api/v1/torrents/trr_new/files') return json({ items: [{ id: 'fil_other', path: ['Spring.mkv'], size_bytes: 100 }, { id: 'fil_one', path: ['Sintel.mkv'], size_bytes: 100 }], links: {} });
        assert.equal(url.pathname, '/api/v1/torrents/trr_new/files/fil_one');
        return json({ id: 'fil_one', links: { content: '/api/v1/torrents/trr_new/files/fil_one/content?download=false' }, path: ['Sintel.mkv'], size_bytes: 100 });
      };
      const torrent = await TorstApi.recoverTorrent(instance, hash, source(retention));
      assert.equal(torrent.id, 'trr_new');
      assert.equal(torrent.files[1].fileId, 'fil_one');
      const content = new URL(await TorstApi.getRecoveredStreamUrl(instance, torrent, 'fil_one'));
      assert.equal(content.pathname, '/api/v1/torrents/trr_new/files/fil_one/content');
      assert.equal(content.searchParams.get('token'), 'torrent-secret');
      assert.equal(content.searchParams.get('download'), 'false');
    });
  }

  it('reuses a restored persisted torrent without posting it again', async () => {
    globalThis.fetch = async (input, options) => {
      assert.notEqual(options?.method, 'POST');
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [{ ...original, retention: 'persisted' }], links: {} });
      if (path.endsWith('/files')) return json({ items: [{ id: 'fil_one', path: ['Sintel.mkv'], size_bytes: 100 }], links: {} });
      return json({ ...original, retention: 'persisted' });
    };
    assert.equal((await TorstApi.recoverTorrent(instance, hash, source('persisted'))).id, 'trr_old');
  });

  it('resolves a concurrent duplicate without downgrading persisted retention', async () => {
    let posted = false;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      assert.notEqual(options?.method, 'PATCH');
      if (options?.method === 'POST') { posted = true; return json({ torrent: '/api/v1/torrents/trr_new' }, 409); }
      if (path === '/api/v1/torrents') return json({ items: posted ? [{ ...replacement, retention: 'persisted' }] : [], links: {} });
      if (path.endsWith('/files')) return json({ items: [], links: {} });
      return json({ ...replacement, retention: 'persisted' });
    };
    assert.equal((await TorstApi.recoverTorrent(instance, hash, source())).retention, 'persisted');
  });

  it('does not repeat an upload whose response was lost', async () => {
    let posts = 0;
    globalThis.fetch = async (_input, options) => {
      if (options?.method === 'POST') { posts++; throw new TypeError('connection lost'); }
      return json({ items: [], links: {} });
    };
    await assert.rejects(TorstApi.recoverTorrent(instance, hash, source()));
    assert.equal(posts, 1);
  });

  it('does not create a torrent after its session is canceled during lookup', async () => {
    let isCanceled = false;
    globalThis.fetch = async (_input, options) => {
      assert.notEqual(options?.method, 'POST');
      isCanceled = true;
      return json({ items: [], links: {} });
    };
    await assert.rejects(TorstApi.recoverTorrent(instance, hash, source(), () => isCanceled), /canceled/);
  });

  it('does not guess a magnet or retention when no recovery source was captured', async () => {
    globalThis.fetch = async (_input, options) => { assert.notEqual(options?.method, 'POST'); return json({ items: [], links: {} }); };
    await assert.rejects(TorstApi.recoverTorrent(instance, hash), /not in Torst/);
  });

  it('rejects content links outside the instance API before obtaining a playback URL', async () => {
    globalThis.fetch = async () => json({ id: 'fil_one', links: { content: 'https://other.test/stream' }, path: ['Sintel.mkv'], size_bytes: 100 });
    await assert.rejects(TorstApi.getRecoveredStreamUrl(instance, source().torrent, 'fil_one'), /Invalid Torst content link/);
  });
});
