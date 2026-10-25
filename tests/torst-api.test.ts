// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { AuthManager } from '../src/api/auth';
import { extractHashFromMagnet, normalizeInfoHash, PreloadStartUnconfirmedError, TorstApi, TorstApiError } from '../src/api/torst';
import { TorstInstance } from '../src/types/torst';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const TORRENT_PATH = '/api/v1/torrents/trr_test';
const FILE_PATH = `${TORRENT_PATH}/files/fil_test`;
const INSTANCE: TorstInstance = { authType: 'none', id: 'test', name: 'Test', url: 'http://localhost:8080' };
const RESOURCE = {
  created_at: '2026-10-24T12:00:00Z',
  file_count: 1,
  id: 'trr_test',
  info_hashes: [{ algorithm: 'sha1', value: HASH }],
  name: 'Sintel',
  observed_state: 'downloading',
  poster: null,
  retention: 'persisted',
  size_bytes: 1024,
  storage_mode: 'memory',
  title: 'Sintel',
};
const FILE = { id: 'fil_test', path: ['Sintel', 'Sintel.mkv'], size_bytes: 1024 };
function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { headers, status });
}

describe('Torst API contract', () => {
  const originalFetch = globalThis.fetch;
  const originalLampa = (globalThis as any).Lampa;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).Lampa = originalLampa;
    TorstApi.resetForTesting();
    mock.restoreAll();
  });

  it('checks unauthenticated readiness and records latency', async () => {
    const instance = { ...INSTANCE };
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), `${instance.url}/readyz`);
      assert.equal(options?.headers, undefined);
      return json({ status: 'ok' });
    };
    assert.equal((await TorstApi.checkHealth(instance)).isOk, true);
    assert.equal(instance.status, 'online');
    assert.equal(instance.checkedUrl, instance.url);
    assert.ok((instance.latencyMs ?? -1) >= 0);
  });

  it('records offline readiness and ignores an instance URL changed during the check', async () => {
    const instance = { ...INSTANCE };
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal((await TorstApi.checkHealth(instance)).isOk, false);
    assert.equal(instance.status, 'offline');
    instance.status = 'unknown';
    globalThis.fetch = async () => {
      instance.url = 'http://changed.local:8080';
      return json({});
    };
    assert.equal((await TorstApi.checkHealth(instance)).isOk, false);
    assert.equal(instance.status, 'unknown');
  });

  it('creates magnets with Torst field names and maps disk storage', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), `${INSTANCE.url}/api/v1/torrents`);
      assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(String(options?.body)), {
        magnet_uri: `magnet:?xt=urn:btih:${HASH}`,
        retention: 'persisted',
        storage_mode: 'disk',
        title: 'Sintel',
      });
      return json({ ...RESOURCE, storage_mode: 'disk' }, 201);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH.toUpperCase(), storage: 'file', title: 'Sintel' });
    assert.equal(torrent.id, 'trr_test');
    assert.equal(torrent.hash, HASH);
    assert.equal(torrent.storage, 'file');
    assert.equal(torrent.file_count, 1);
    assert.deepEqual(torrent.files, []);
  });

  it('follows the duplicate problem resource instead of addressing a torrent by hash', async () => {
    const paths: string[] = [];
    globalThis.fetch = async (input, options) => {
      paths.push(String(input));
      return options?.method === 'POST'
        ? json({ detail: 'Already tracked', torrent: TORRENT_PATH }, 409)
        : json(RESOURCE);
    };
    assert.equal((await TorstApi.addTorrent(INSTANCE, { hash: HASH })).hash, HASH);
    assert.deepEqual(paths, [`${INSTANCE.url}/api/v1/torrents`, `${INSTANCE.url}${TORRENT_PATH}`]);
  });

  it('rejects duplicate links outside this API before sending credentials', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return json({ torrent: 'https://other.test/api/v1/torrents/trr_test' }, 409);
    };
    await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH }), /Invalid Torst resource link/);
    assert.equal(calls, 1);
  });

  it('uses repeated info_hash filters and follows cursor pagination in order', async () => {
    const paths: string[] = [];
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      paths.push(url.pathname + url.search);
      if (paths.length === 1) {
        assert.deepEqual(url.searchParams.getAll('info_hash'), [HASH, 'a'.repeat(40)]);
        assert.equal(url.searchParams.get('search'), 'Sintel');
        assert.equal(url.searchParams.get('fuzzy'), 'true');
        assert.equal(url.searchParams.get('page_size'), '200');
        return json({ facets: { categories: [], total: 2, version: 'lv-test' }, items: [RESOURCE], links: { next: '/api/v1/torrents?cursor=opaque' }, total: 2 });
      }
      assert.equal(url.searchParams.get('cursor'), 'opaque');
      return json({ items: [{ ...RESOURCE, id: 'trr_second', info_hashes: [{ algorithm: 'sha1', value: 'a'.repeat(40) }] }], links: {} });
    };
    const listing = await TorstApi.getTorrents(INSTANCE, { fuzzy: true, hashes: [HASH, 'a'.repeat(40)], search: 'Sintel' });
    assert.deepEqual(listing.torrents.map(torrent => torrent.id), ['trr_test', 'trr_second']);
  });

  it('stops repeated pagination links', async () => {
    globalThis.fetch = async () => json({ items: [], links: { next: '/api/v1/torrents?page_size=200' } });
    await assert.rejects(TorstApi.getTorrents(INSTANCE), /repeated a pagination link/);
  });

  it('loads file pages in metadata order and streams by file ID', async () => {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (url.pathname === TORRENT_PATH) return json({ ...RESOURCE, file_count: 2 });
      if (url.searchParams.has('cursor')) return json({ items: [{ ...FILE, id: 'fil_second', path: ['Sintel', 'Extra.mkv'] }], links: {} });
      assert.equal(url.pathname, `${TORRENT_PATH}/files`);
      return json({ items: [FILE], links: { next: `${TORRENT_PATH}/files?cursor=next` } });
    };
    const torrent = await TorstApi.getTorrent(INSTANCE, HASH);
    assert.equal(torrent.files[0].path, 'Sintel/Sintel.mkv');
    assert.equal(torrent.files[1].fileId, 'fil_second');
    assert.equal(await TorstApi.getStreamUrl(INSTANCE, HASH, { index: 1 }), `${INSTANCE.url}${TORRENT_PATH}/files/fil_second/content`);
    assert.equal(await TorstApi.getStreamUrl(INSTANCE, HASH, { path: 'Sintel/Sintel.mkv' }), `${INSTANCE.url}${FILE_PATH}/content`);
    await assert.rejects(TorstApi.getStreamUrl(INSTANCE, HASH, { index: 7 }), /file is not available/);
  });

  it('uses playback tokens on content URLs without a bootstrap magnet', async () => {
    globalThis.fetch = async input => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      return json({ items: [FILE], links: {} });
    };
    mock.method(AuthManager, 'getPlaybackToken', async () => 'secret token');
    assert.equal(await TorstApi.getStreamUrl(INSTANCE, HASH, { index: 0 }), `${INSTANCE.url}${FILE_PATH}/content?token=secret%20token`);
  });

  it('does not create a missing torrent during a temporary lookup', async () => {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.method || 'GET', 'GET');
      return json({ items: [], links: {} });
    };
    await assert.rejects(TorstApi.getTorrent(INSTANCE, HASH), /not in Torst/);
  });

  it('imports torrent file bytes as multipart data with the selected storage', async () => {
    globalThis.fetch = async (input, options) => {
      if (String(input) === 'https://indexer.test/sintel.torrent') return new Response('torrent bytes');
      assert.equal(String(input), `${INSTANCE.url}/api/v1/torrents`);
      assert.equal(options?.method, 'POST');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('storage_mode'), 'disk');
      assert.equal(options.body.get('title'), 'Sintel');
      const file = options.body.get('torrent_file') as File;
      assert.equal(await file.text(), 'torrent bytes');
      return json(RESOURCE, 201);
    };
    assert.equal((await TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { storage: 'file', title: 'Sintel' })).id, 'trr_test');
  });

  it('uses the configuration ETag and merge patch for storage changes', async () => {
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path.endsWith('/configuration')) {
        if (options?.method === 'PATCH') {
          assert.equal((options.headers as Record<string, string>)['If-Match'], '"cfg-test"');
          assert.equal((options.headers as Record<string, string>)['Content-Type'], 'application/merge-patch+json');
          assert.deepEqual(JSON.parse(String(options.body)), { storage_mode: 'disk' });
          return json({ storage_mode: 'disk' });
        }
        return json({ storage_mode: 'memory' }, 200, { ETag: '"cfg-test"' });
      }
      if (path === TORRENT_PATH) return json({ ...RESOURCE, storage_mode: 'disk' });
      return json({ items: [FILE], links: {} });
    };
    assert.equal((await TorstApi.updateTorrent(INSTANCE, HASH, { storage: 'file' })).storage, 'file');
  });

  it('refuses a settings patch without an exposed ETag and reports stale versions', async () => {
    globalThis.fetch = async () => json({ background_downloads: true });
    await assert.rejects(TorstApi.updateSettings(INSTANCE, { background_downloads: false }), /ETag/);
    globalThis.fetch = async (_input, options) => options?.method === 'PATCH'
      ? json({ detail: 'Settings changed' }, 412)
      : json({}, 200, { ETag: '"set-test"' });
    await assert.rejects(TorstApi.updateSettings(INSTANCE, { background_downloads: false }), (error: unknown) => error instanceof TorstApiError && error.status === 412);
  });

  it('creates, reads, and deletes a per-file preload and maps transfer statistics', async () => {
    let preloadState = 'downloading';
    const calls: string[] = [];
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      calls.push(`${options?.method || 'GET'} ${path}`);
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({ download_rate_bytes_per_second: 1024, peer_count: 4 });
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') assert.deepEqual(JSON.parse(String(options.body)), { ttl_seconds: 300 });
      return json({ completed_bytes: 256, id: 'prl_test', state: preloadState, target_bytes: 1024 }, options?.method === 'POST' ? 201 : 200);
    };
    const started = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    assert.equal(started.status, 'preloading');
    assert.equal(started.download_rate, 1024);
    assert.equal(started.active_peers, 4);
    preloadState = 'ready';
    assert.equal((await TorstApi.getPreload(INSTANCE, HASH)).status, 'ready');
    preloadState = 'expired';
    assert.equal((await TorstApi.getPreload(INSTANCE, HASH)).status, 'evicted');
    await TorstApi.cancelPreload(INSTANCE, HASH);
    assert.deepEqual(await TorstApi.getPreload(INSTANCE, HASH), { status: 'idle' });
    assert.ok(calls.includes(`POST ${FILE_PATH}/preloads`));
    assert.ok(calls.includes(`GET ${FILE_PATH}/preloads/prl_test`));
    assert.ok(calls.includes(`DELETE ${FILE_PATH}/preloads/prl_test`));
  });

  it('deletes by resource ID and invalidates the hash lookup', async () => {
    let hasDeleted = false;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === 'DELETE') {
        assert.equal(path, TORRENT_PATH);
        hasDeleted = true;
        return new Response(null, { status: 204 });
      }
      return json({ items: hasDeleted ? [] : [RESOURCE], links: {} });
    };
    await TorstApi.deleteTorrent(INSTANCE, HASH);
    await assert.rejects(TorstApi.getTorrent(INSTANCE, HASH), /not in Torst/);
  });

  it('keeps resource IDs isolated by instance URL', async () => {
    globalThis.fetch = async input => {
      const host = new URL(String(input)).hostname;
      return json({ items: [{ ...RESOURCE, id: host === 'second.test' ? 'trr_second' : 'trr_test' }], links: {} });
    };
    const instance = { ...INSTANCE };
    assert.equal((await TorstApi.getTorrents(instance)).torrents[0].id, 'trr_test');
    instance.url = 'http://second.test';
    assert.equal((await TorstApi.getTorrents(instance)).torrents[0].id, 'trr_second');
  });
  it('creates temporary magnets without library fields, posters, or disk storage', async () => {
    const requests: string[] = [];
    globalThis.fetch = async (input, options) => {
      requests.push(String(input));
      assert.deepEqual(JSON.parse(String(options?.body)), {
        magnet_uri: `magnet:?xt=urn:btih:${HASH}`,
        retention: 'temporary',
        storage_mode: 'memory',
      });
      return json({ ...RESOURCE, retention: 'temporary', title: null }, 201);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, poster: 'https://images.test/sintel.jpg', retention: 'temporary', storage: 'file', title: 'Sintel' });
    assert.equal(torrent.retention, 'temporary');
    assert.equal(requests.length, 1);
  });

  it('uploads temporary files without library form parts or poster requests', async () => {
    let calls = 0;
    globalThis.fetch = async (_input, options) => {
      if (++calls === 1) return new Response('torrent bytes');
      assert.ok(options?.body instanceof FormData);
      assert.equal(options.body.get('retention'), 'temporary');
      assert.equal(options.body.get('storage_mode'), 'memory');
      assert.equal(options.body.has('title'), false);
      return json({ ...RESOURCE, retention: 'temporary' }, 201);
    };
    const torrent = await TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { poster: 'https://images.test/sintel.jpg', retention: 'temporary', storage: 'file', title: 'Sintel' });
    assert.equal(torrent.retention, 'temporary');
    assert.equal(calls, 2);
  });

  it('promotes a duplicate temporary torrent before saving library metadata or disk storage', async () => {
    let isPromoted = false;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (path.endsWith('/configuration')) {
        if (options?.method === 'PATCH') {
          assert.deepEqual(JSON.parse(String(options.body)), { retention: 'persisted', storage_mode: 'disk', title: 'Sintel' });
          assert.equal((options.headers as Record<string, string>)['If-Match'], '"cfg-temp"');
          isPromoted = true;
          return json({});
        }
        return json({ retention: 'temporary' }, 200, { ETag: '"cfg-temp"' });
      }
      assert.equal(path, TORRENT_PATH);
      return json({ ...RESOURCE, retention: isPromoted ? 'persisted' : 'temporary', storage_mode: isPromoted ? 'disk' : 'memory' });
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'persisted', storage: 'file', title: 'Sintel' });
    assert.equal(torrent.id, RESOURCE.id);
    assert.equal(torrent.retention, 'persisted');
    assert.equal(torrent.storage, 'file');
  });

  it('reuses an existing persisted torrent for a temporary request without downgrading it', async () => {
    const methods: string[] = [];
    globalThis.fetch = async (_input, options) => {
      methods.push(options?.method || 'GET');
      return options?.method === 'POST' ? json({ torrent: TORRENT_PATH }, 409) : json(RESOURCE);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'temporary' });
    assert.equal(torrent.retention, 'persisted');
    assert.deepEqual(methods, ['POST', 'GET']);
  });

  it('reports a full temporary pool without treating it as a duplicate', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return json({ detail: 'All temporary torrents are streaming' }, 409);
    };
    await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'temporary' }), (error: unknown) => error instanceof TorstApiError && error.status === 409);
    assert.equal(calls, 1);
  });

  it('finds temporary torrents with retention=any without changing the library filter', async () => {
    const filters: Array<string | null> = [];
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === TORRENT_PATH) return json({ ...RESOURCE, file_count: null, retention: 'temporary' });
      filters.push(url.searchParams.get('retention'));
      return json({ items: url.searchParams.get('retention') === 'any' ? [{ ...RESOURCE, retention: 'temporary' }] : [], links: {} });
    };
    assert.deepEqual((await TorstApi.getTorrents(INSTANCE)).torrents, []);
    assert.equal((await TorstApi.getTorrent(INSTANCE, HASH)).retention, 'temporary');
    assert.deepEqual(filters, [null, 'any']);
  });

  it('does not upload a torrent file when canceled during its download', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('torrent bytes'); };
    await assert.rejects(TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { retention: 'temporary' }, () => calls > 0), /Playback canceled/);
    assert.equal(calls, 1);
  });

  it('keeps library reads on the native transport when browser CORS requests are blocked', async () => {
    let calls = 0;
    globalThis.fetch = async () => { throw new TypeError('CORS blocked'); };
    (globalThis as any).Lampa = {
      Reguest: class {
        public timeout() {}
        public native(_url: string, success: (data: object) => void, _failure: unknown, _body: unknown, params: { headers: Record<string, string>, type: string }) {
          calls++;
          assert.equal(params.type, 'GET');
          assert.equal(params.headers['If-None-Match'], undefined);
          success({ items: [RESOURCE], links: {} });
        }
        public silent() { throw new Error('Native transport is available'); }
      },
    };
    assert.equal((await TorstApi.getTorrents(INSTANCE)).torrents[0].hash, HASH);
    assert.equal((await TorstApi.getTorrents(INSTANCE)).torrents[0].hash, HASH);
    assert.equal(calls, 2);
  });

  for (const concurrent of [false, true]) {
    it(`releases ready preloads before another file starts (${concurrent ? 'concurrent' : 'sequential'} calls)`, async () => {
      const active = new Set<string>();
      const operations: string[] = [];
      let nextId = 0;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json({ ...RESOURCE, file_count: 2 });
        if (path.endsWith('/files')) return json({ items: [FILE, { ...FILE, id: 'fil_second' }], links: {} });
        if (path.endsWith('/statistics')) return json({ peer_count: 1 });
        if (options?.method === 'DELETE') {
          const id = path.split('/').pop() as string;
          operations.push(`delete ${id}`);
          active.delete(id);
          return new Response(null, { status: 204 });
        }
        assert.equal(options?.method, 'POST');
        assert.equal(active.size, 0, 'the preceding preload must release the budget before a new one is created');
        const id = `prl_${++nextId}`;
        active.add(id);
        operations.push(`create ${id}`);
        return json({ completed_bytes: 1024, id, state: 'ready', target_bytes: 1024 }, 201);
      };
      const firstRequest = TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      if (!concurrent) await firstRequest;
      const secondRequest = TorstApi.startPreload(INSTANCE, HASH, { file_index: 1 });
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.deepEqual(operations, ['create prl_1', 'delete prl_1', 'create prl_2']);
      await TorstApi.cancelPreload(INSTANCE, HASH, first.preloadId);
      assert.deepEqual(Array.from(active), ['prl_2'], 'a late cancellation must not cancel the replacement');
      assert.equal((await TorstApi.getPreload(INSTANCE, HASH, first.preloadId)).status, 'evicted');
      await TorstApi.cancelPreload(INSTANCE, HASH, second.preloadId);
      assert.equal(active.size, 0);
    });
  }

  it('releases preceding torrents on the same instance while leaving other instances alone', async () => {
    const operations: string[] = [];
    let nextId = 0;
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      const hash = url.searchParams.get('info_hash') || HASH;
      if (url.pathname === '/api/v1/torrents') return json({ items: [{ ...RESOURCE, info_hashes: [{ algorithm: 'sha1', value: hash }] }], links: {} });
      if (url.pathname === TORRENT_PATH) return json(RESOURCE);
      if (url.pathname.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (url.pathname.endsWith('/statistics')) return json({});
      if (options?.method === 'DELETE') {
        operations.push(`delete ${url.hostname}`);
        return new Response(null, { status: 404 });
      }
      operations.push(`create ${url.hostname}`);
      return json({ completed_bytes: 1024, id: `prl_${++nextId}`, state: 'ready', target_bytes: 1024 }, 201);
    };
    await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    const other = { ...INSTANCE, id: 'other', url: 'http://other.test' };
    await TorstApi.startPreload(other, HASH, { file_index: 0 });
    await TorstApi.startPreload(INSTANCE, 'a'.repeat(40), { file_index: 0 });
    assert.deepEqual(operations, ['create localhost', 'create other.test', 'delete localhost', 'create localhost']);
  });

  for (const fraction of [0.5, 0.333, undefined, NaN, Infinity, -0.1, 0, 1]) {
    it(`maps a valid resume fraction to file bytes (${String(fraction)})`, async () => {
      let payload: { offset_bytes?: number, ttl_seconds: number } | undefined;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        if (path.endsWith('/statistics')) return json({});
        payload = JSON.parse(String(options?.body));
        return json({ completed_bytes: 0, id: 'prl_resume', state: 'downloading', target_bytes: 1024 }, 201);
      };
      await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0, playbackFraction: fraction });
      assert.deepEqual(payload, fraction && fraction > 0 && fraction < 1
        ? { offset_bytes: Math.floor(1024 * fraction), ttl_seconds: 300 }
        : { ttl_seconds: 300 });
    });
  }

  it('starts a paused torrent before creating its preload', async () => {
    const operations: string[] = [];
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [{ ...RESOURCE, observed_state: 'paused' }], links: {} });
      if (path === TORRENT_PATH) return json({ ...RESOURCE, observed_state: 'paused' });
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({});
      if (path.endsWith('/configuration')) {
        operations.push(options?.method || 'GET');
        if (options?.method === 'PATCH') {
          assert.deepEqual(JSON.parse(String(options.body)), { desired_state: 'started' });
          return json({});
        }
        return json({}, 200, { ETag: '"cfg-paused"' });
      }
      operations.push(options?.method || 'GET');
      return json({ completed_bytes: 0, id: 'prl_started', state: 'downloading', target_bytes: 1024 }, 201);
    };
    await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    assert.deepEqual(operations, ['GET', 'PATCH', 'POST']);
  });

  it('isolates cached torrent data from caller mutations', async () => {
    globalThis.fetch = async (_input, options) => (options?.headers as Record<string, string>)['If-None-Match']
      ? new Response(null, { status: 304 })
      : json({ facets: { categories: [{ count: 1, name: 'Animation' }], total: 1, version: 'test' }, items: [RESOURCE], links: {} }, 200, { ETag: '"listing"' });
    const first = await TorstApi.getTorrents(INSTANCE);
    first.torrents[0].name = 'Changed';
    first.torrents[0].files.push({ length: 1, name: 'Injected.mkv', path: 'Injected.mkv' });
    const second = await TorstApi.getTorrents(INSTANCE);
    assert.equal(second.torrents[0].name, RESOURCE.name);
    assert.deepEqual(second.torrents[0].files, []);
  });

  for (const link of ['/api/v1/../../private', '/api/v1/%2e%2e/%2e%2e/private']) {
    it(`rejects a resource link that escapes the API (${link})`, async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return json({ torrent: link }, 409); };
      await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH }), /Invalid Torst resource link/);
      assert.equal(calls, 1);
    });
  }

  it('discards an API answer after its instance URL changes', async () => {
    const instance = { ...INSTANCE };
    globalThis.fetch = async () => {
      instance.url = 'http://changed.test';
      return json({ items: [RESOURCE], links: {} });
    };
    await assert.rejects(TorstApi.getTorrents(instance), /settings changed/);
  });

  it('does not invalidate a fresh access token when a second old request returns 401', async () => {
    const instance: TorstInstance = { ...INSTANCE, accessToken: 'old', accessTokenExpiresAtMs: Infinity, authType: 'bearer', password: 'password' };
    let loginCalls = 0;
    let oldRequests = 0;
    let finish: (response: Response) => void = () => {};
    globalThis.fetch = async (input, options) => {
      if (String(input).endsWith('/access-tokens')) {
        loginCalls++;
        return json({ expires_at: null, secret: 'fresh' });
      }
      if ((options?.headers as Record<string, string>).Authorization === 'Bearer old') {
        if (++oldRequests === 1) return new Response(null, { status: 401 });
        return new Promise(resolve => { finish = resolve; });
      }
      return json({ background_downloads: true });
    };
    const first = TorstApi.getSettings(instance);
    const second = TorstApi.getSettings(instance);
    await first;
    finish(new Response(null, { status: 401 }));
    await second;
    assert.equal(loginCalls, 1);
    assert.equal(instance.accessToken, 'fresh');
  });

  it('rejects an oversized downloaded torrent before uploading it', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(new Uint8Array(10 * 1024 * 1024 + 1)); };
    await assert.rejects(TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent'), (error: unknown) => error instanceof TorstApiError && error.status === 413);
    assert.equal(calls, 1);
  });

  it('refreshes a cached info-hash lookup after the server replaces its resource ID', async () => {
    let hasReplaced = false;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/torrents') return json({ items: [{ ...RESOURCE, id: hasReplaced ? 'trr_new' : 'trr_test' }], links: {} });
      if (url.pathname === TORRENT_PATH) return new Response(null, { status: 404 });
      assert.equal(url.pathname, '/api/v1/torrents/trr_new');
      return json({ ...RESOURCE, file_count: null, id: 'trr_new' });
    };
    await TorstApi.getTorrents(INSTANCE);
    hasReplaced = true;
    assert.equal((await TorstApi.getTorrent(INSTANCE, HASH)).id, 'trr_new');
  });

  it('renews an expired preload at the saved offset while buffering continues', async () => {
    const payloads: unknown[] = [];
    let count = 0;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({});
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') {
        payloads.push(JSON.parse(String(options.body)));
        return json({ completed_bytes: 256, id: `prl_${++count}`, state: 'downloading', target_bytes: 1024 }, 201);
      }
      return json({ completed_bytes: 512, id: 'prl_1', state: 'expired', target_bytes: 1024 });
    };
    const started = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0, playbackFraction: 0.5 });
    const renewed = await TorstApi.getPreload(INSTANCE, HASH, started.preloadId);
    assert.equal(renewed.preloadId, 'prl_2');
    assert.equal(renewed.status, 'preloading');
    assert.deepEqual(payloads, [{ offset_bytes: 512, ttl_seconds: 300 }, { offset_bytes: 512, ttl_seconds: 300 }]);
  });

  it('does not renew a superseded preload whose status arrives late', async () => {
    let count = 0;
    let complete: (response: Response) => void = () => {};
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (options?.method === 'POST') return json({ completed_bytes: 1024, id: `prl_${++count}`, state: 'ready', target_bytes: 1024 }, 201);
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Promise(resolve => { complete = resolve; });
    };
    const first = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    const pending = TorstApi.getPreload(INSTANCE, HASH, first.preloadId);
    await new Promise(resolve => setImmediate(resolve));
    await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    complete(json({ completed_bytes: 1024, id: first.preloadId, state: 'expired', target_bytes: 1024 }));
    assert.deepEqual(await pending, { status: 'evicted' });
    assert.equal(count, 2);
  });

  it('does not upload a downloaded file to an instance whose URL changed during the download', async () => {
    const instance = { ...INSTANCE };
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      instance.url = 'http://changed.test';
      return new Response('torrent bytes');
    };
    await assert.rejects(TorstApi.resolveTorrent(instance, 'https://indexer.test/sintel.torrent'), /settings changed/);
    assert.equal(calls, 1);
  });

  for (const failure of ['lost', 'malformed', 'empty']) {
    it(`does not repeat a preload creation whose reply is ${failure}`, async () => {
      let posts = 0;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        assert.equal(options?.method, 'POST');
        posts++;
        if (failure === 'lost') throw new TypeError('Reply lost');
        return new Response(failure === 'empty' ? null : '{broken', { status: 201 });
      };
      await assert.rejects(TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 }), PreloadStartUnconfirmedError);
      assert.equal(posts, 1);
    });
  }

  it('extractHashFromMagnet extracts 40-char hex and converts 32-char base32 info hashes', () => {
    const hexHash = '0123456789abcdef0123456789abcdef01234567';
    const magnetHex = `magnet:?xt=urn:btih:${hexHash}&dn=Test`;
    assert.equal(extractHashFromMagnet(magnetHex), hexHash);

    // 32-char base32 test vector (32 characters = 160 bits = 20 bytes)
    const base32Hash = '234567abcdefghijklmnopqrstuvwxyz';
    const magnetBase32 = `magnet:?xt=urn:btih:${base32Hash}&dn=Test`;
    const extracted = extractHashFromMagnet(magnetBase32);
    assert.ok(extracted);
    assert.equal(extracted?.length, 40);

    assert.equal(extractHashFromMagnet(''), null);
    assert.equal(extractHashFromMagnet('invalid-uri'), null);
  });

  it('normalizeInfoHash validates hex, decodes base32, and rejects invalid strings', () => {
    const validHex = '0123456789ABCDEF0123456789ABCDEF01234567';
    assert.equal(normalizeInfoHash(validHex), validHex.toLowerCase());

    const validBase32 = '234567abcdefghijklmnopqrstuvwxyz';
    const decoded = normalizeInfoHash(validBase32);
    assert.ok(decoded);
    assert.equal(decoded?.length, 40);

    // Lampa internal numeric title hashes or invalid hashes
    assert.equal(normalizeInfoHash('2938472948'), null);
    assert.equal(normalizeInfoHash('12345'), null);
    assert.equal(normalizeInfoHash(''), null);
    assert.equal(normalizeInfoHash('   '), null);
    assert.equal(normalizeInfoHash(null), null);
    assert.equal(normalizeInfoHash(undefined), null);
    assert.equal(normalizeInfoHash({}), null);
    assert.equal(normalizeInfoHash('not-a-valid-hex-or-base32-hash-value-1234567890'), null);
  });

  it('extracts encoded exact topics and rejects partial or unrelated magnet values', () => {
    const hash = '0123456789abcdef0123456789abcdef01234567';
    assert.equal(extractHashFromMagnet(`magnet:?XT=${encodeURIComponent(`URN:BTIH:${hash}`)}`), hash);
    assert.equal(extractHashFromMagnet(`magnet:?xt=urn:btmh:ignored&xt=urn:btih:${hash}`), hash);
    for (const magnet of [
      `magnet:?notxt=urn:btih:${hash}`,
      `magnet:?dn=xt=urn:btih:${hash}`,
      `magnet:?xt=urn:btih:${hash}0`,
      `magnet:?xt=urn:btih:${hash.slice(0, -1)}g`,
      `https://example.com/?xt=urn:btih:${hash}`,
    ]) {
      assert.equal(extractHashFromMagnet(magnet), null, magnet);
    }
  });

});
