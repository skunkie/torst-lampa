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
        ? json({ detail: 'Already tracked', torrent: TORRENT_PATH, type: 'tag:skunkie.github.io,2026:torrplay/problems/duplicate-torrent' }, 409)
        : json(RESOURCE);
    };
    assert.equal((await TorstApi.addTorrent(INSTANCE, { hash: HASH })).hash, HASH);
    assert.deepEqual(paths, [`${INSTANCE.url}/api/v1/torrents`, `${INSTANCE.url}${TORRENT_PATH}`]);
  });

  it('retries playback after canceling a preload when Android omits the duplicate response body', async () => {
    let creationCount = 0;
    const methods: string[] = [];
    (globalThis as any).Lampa = {
      Platform: { is: () => true },
      Reguest: class {
        public timeout() {}
        public native(url: string, success: (body: string) => void, failure: (error: unknown) => void, _body: unknown, params: any) {
          const resource = new URL(url);
          methods.push(`${params.type} ${resource.pathname}`);
          if (resource.pathname === '/readyz') { failure({ status: 405 }); return; }
          if (params.type === 'DELETE') { success(''); return; }
          if (params.type === 'POST' && resource.pathname === '/api/v1/torrents') {
            if (++creationCount === 1) success(JSON.stringify({ ...RESOURCE, retention: 'temporary' }));
            else failure({ message: 'Invalid response from server: 409 Conflict', status: 409 });
            return;
          }
          if (resource.pathname === '/api/v1/torrents') {
            assert.deepEqual(resource.searchParams.getAll('info_hash'), [HASH]);
            assert.equal(resource.searchParams.get('retention'), 'any');
            success(JSON.stringify({ items: [{ ...RESOURCE, retention: 'temporary' }], links: {} }));
          } else if (resource.pathname.endsWith('/files')) success(JSON.stringify({ items: [FILE], links: {} }));
          else if (resource.pathname.endsWith('/preloads')) success(JSON.stringify({ completed_bytes: 1024, id: `prl_${creationCount}`, state: 'ready', target_bytes: 1024 }));
          else success(JSON.stringify({ ...RESOURCE, retention: 'temporary' }));
        }
        public silent() { assert.fail('Native Android transport must handle this flow'); }
      },
    };
    await TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'temporary' });
    const first = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    await TorstApi.cancelPreload(INSTANCE, HASH, first.preloadId);
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'temporary' });
    assert.equal(torrent.id, RESOURCE.id);
    assert.equal((await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 })).preloadId, 'prl_2');
    assert.equal(creationCount, 2);
    assert.equal(methods.filter(method => method === `DELETE ${FILE_PATH}/preloads/prl_1`).length, 1);
    assert.equal(methods.filter(method => method === `POST ${FILE_PATH}/preloads`).length, 2);
  });

  it('resolves a bodyless conflict from a magnet through fresh paginated temporary-torrent listings', async () => {
    const paths: string[] = [];
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      paths.push(`${options?.method || 'GET'} ${url.pathname}`);
      if (options?.method === 'POST') return new Response(null, { status: 409 });
      if (url.pathname === '/api/v1/torrents') {
        assert.equal(new Headers(options?.headers).get('If-None-Match'), null);
        if (!url.searchParams.has('cursor')) {
          assert.deepEqual(url.searchParams.getAll('info_hash'), [HASH]);
          assert.equal(url.searchParams.get('retention'), 'any');
          return json({ items: [], links: { next: '/api/v1/torrents?cursor=next' } });
        }
        return json({ items: [{ ...RESOURCE, retention: 'temporary' }], links: {} });
      }
      assert.equal(url.pathname, TORRENT_PATH);
      return json({ ...RESOURCE, retention: 'temporary' });
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { magnet: `magnet:?xt=urn:btih:${HASH.toUpperCase()}`, retention: 'temporary' });
    assert.equal(torrent.id, RESOURCE.id);
    assert.equal(torrent.retention, 'temporary');
    assert.deepEqual(paths, ['POST /api/v1/torrents', 'GET /api/v1/torrents', 'GET /api/v1/torrents', `GET ${TORRENT_PATH}`]);
  });

  it('recovers a conflict using the trimmed magnet actually sent rather than a conflicting hash hint', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (options?.method === 'POST') {
        assert.equal(JSON.parse(String(options.body)).magnet_uri, `magnet:?xt=urn:btih:${HASH}`);
        return new Response(null, { status: 409 });
      }
      if (url.pathname === '/api/v1/torrents') {
        assert.deepEqual(url.searchParams.getAll('info_hash'), [HASH]);
        return json({ items: [RESOURCE], links: {} });
      }
      return json(RESOURCE);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: 'a'.repeat(40), magnet: `  magnet:?xt=urn:btih:${HASH}  ` });
    assert.equal(torrent.hash, HASH);
  });

  it('does not identify uploaded metainfo from an unrelated hash or magnet hint', async () => {
    let calls = 0;
    globalThis.fetch = async (input, options) => {
      calls++;
      const url = new URL(String(input));
      if (url.hostname === 'indexer.test') return new Response(new Blob(['metainfo'], { type: 'application/x-bittorrent' }));
      if (options?.method === 'POST') {
        assert.ok(options.body instanceof FormData);
        return new Response(null, { status: 409 });
      }
      if (url.pathname === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      return json(RESOURCE);
    };
    await assert.rejects(TorstApi.resolveTorrent(INSTANCE, 'http://indexer.test/sintel.torrent', { hash: HASH, magnet: `magnet:?xt=urn:btih:${HASH}` }), (error: unknown) => error instanceof TorstApiError && error.status === 409);
    assert.equal(calls, 2);
  });

  for (const matches of [[], [{ ...RESOURCE, info_hashes: [{ algorithm: 'sha1', value: 'a'.repeat(40) }] }]]) {
    it(`preserves the original creation conflict when lookup finds ${matches.length ? 'an unrelated torrent' : 'no torrent'}`, async () => {
      let creationCount = 0;
      globalThis.fetch = async (_input, options) => {
        if (options?.method === 'POST') {
          creationCount++;
          return new Response(null, { status: 409 });
        }
        return json({ items: matches, links: {} });
      };
      await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH }), (error: unknown) => error instanceof TorstApiError && error.status === 409);
      assert.equal(creationCount, 1);
    });
  }

  for (const problemType of ['https://other.test/problems/duplicate-torrent', 'tag:skunkie.github.io,2026:torrplay/problems/lifecycle-conflict', '']) {
    for (const hasResource of [false, true]) {
      it(`rejects an explicit non-duplicate problem type ${JSON.stringify(problemType)} ${hasResource ? 'with' : 'without'} a resource link`, async () => {
        let calls = 0;
        globalThis.fetch = async (input, options) => {
          calls++;
          if (options?.method === 'POST') return json({ torrent: hasResource ? TORRENT_PATH : undefined, type: problemType }, 409);
          return new URL(String(input)).pathname === '/api/v1/torrents' ? json({ items: [RESOURCE], links: {} }) : json(RESOURCE);
        };
        await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH }), (error: unknown) => error instanceof TorstApiError && error.status === 409 && error.problemType === problemType);
        assert.equal(calls, 1);
      });
    }
  }

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
        return json({ facets: { categories: [], total_count: 2, version: 'lv-test' }, items: [RESOURCE], links: { next: '/api/v1/torrents?cursor=opaque' }, total_count: 2 });
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
      const file = options.body.get('metainfo') as File;
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
    globalThis.fetch = async () => json({ background_downloads_enabled: true });
    await assert.rejects(TorstApi.updateSettings(INSTANCE, { background_downloads_enabled: false }), /ETag/);
    globalThis.fetch = async (_input, options) => options?.method === 'PATCH'
      ? json({ detail: 'Settings changed' }, 412)
      : json({}, 200, { ETag: '"set-test"' });
    await assert.rejects(TorstApi.updateSettings(INSTANCE, { background_downloads_enabled: false }), (error: unknown) => error instanceof TorstApiError && error.status === 412);
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
      if (options?.method === 'POST') assert.deepEqual(JSON.parse(String(options.body)), { expires_in_seconds: 300 });
      return json({ completed_bytes: 256, id: 'prl_test', state: preloadState, target_bytes: 1024 }, options?.method === 'POST' ? 201 : 200);
    };
    const started = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    assert.equal(started.status, 'preloading');
    assert.equal(started.download_rate, 1024);
    assert.equal(started.active_peers, 4);
    preloadState = 'ready';
    assert.equal((await TorstApi.getPreload(INSTANCE, HASH)).status, 'ready');
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
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }

  it('returns a temporary magnet before downloading its poster and uses a fill-only upload', async () => {
    const started = deferred<void>();
    const artwork = deferred<Response>();
    const uploaded = deferred<string | null>();
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.hostname === 'images.test') {
        started.resolve();
        return artwork.promise;
      }
      if (options?.method === 'PUT') {
        uploaded.resolve(new Headers(options.headers).get('If-None-Match'));
        return new Response(null, { status: 412 });
      }
      assert.deepEqual(JSON.parse(String(options?.body)), {
        magnet_uri: `magnet:?xt=urn:btih:${HASH}`,
        retention: 'temporary',
        storage_mode: 'memory',
        title: 'Sintel',
      });
      return json({ ...RESOURCE, retention: 'temporary' }, 201);
    };
    const adding = TorstApi.addTorrent(INSTANCE, { hash: HASH, poster: 'https://images.test/sintel.jpg', retention: 'temporary', storage: 'file', title: 'Sintel' });
    await started.promise;
    const early = await Promise.race([adding, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]);
    artwork.resolve(new Response(new Blob(['poster'], { type: 'image/jpeg' })));
    assert.equal(await uploaded.promise, '*');
    assert.equal(early?.retention, 'temporary');
  });

  it('uploads temporary files with library form parts and a poster', async () => {
    const requests: string[] = [];
    const uploaded = deferred<void>();
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      requests.push(`${options?.method || 'GET'} ${url.pathname}`);
      if (url.hostname === 'indexer.test') return new Response('torrent bytes');
      if (url.hostname === 'images.test') return new Response(new Blob(['poster'], { type: 'image/jpeg' }));
      if (options?.method === 'PUT') {
        uploaded.resolve();
        return new Response(null, { status: 201 });
      }
      assert.ok(options?.body instanceof FormData);
      assert.equal(options.body.get('retention'), 'temporary');
      assert.equal(options.body.get('storage_mode'), 'memory');
      assert.equal(options.body.get('title'), 'Sintel');
      assert.deepEqual(options.body.getAll('genres'), ['Animation', 'Fantasy']);
      return json({ ...RESOURCE, retention: 'temporary' }, 201);
    };
    const torrent = await TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', {
      library: { genres: ['Animation', 'Fantasy'] },
      poster: 'https://images.test/sintel.jpg',
      retention: 'temporary',
      storage: 'file',
      title: 'Sintel',
    });
    assert.equal(torrent.retention, 'temporary');
    await uploaded.promise;
    assert.deepEqual(requests, ['GET /sintel.torrent', 'POST /api/v1/torrents', 'GET /sintel.jpg', `PUT ${TORRENT_PATH}/poster`]);
  });

  it('fills missing metadata for a duplicate temporary torrent without replacing its title', async () => {
    const patched = deferred<{ body: unknown, tag: string | null }>();
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (options?.method === 'PATCH') {
        patched.resolve({ body: JSON.parse(String(options.body)), tag: new Headers(options.headers).get('If-Match') });
        return json({});
      }
      if (path.endsWith('/configuration')) return json({ retention: 'temporary', title: 'Existing title' }, 200, { ETag: '"cfg-temp"' });
      return json({ ...RESOURCE, retention: 'temporary', title: 'Existing title' });
    };
    await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { year: 2010 }, retention: 'temporary', title: 'Sintel' });
    assert.deepEqual(await patched.promise, { body: { year: 2010 }, tag: '"cfg-temp"' });
  });

  for (const timing of ['before the configuration read', 'between the read and write'] as const) {
    it(`fills missing metadata when a temporary duplicate is promoted ${timing}`, { timeout: 2000 }, async () => {
      const finished = deferred<void>();
      const writes: { body: unknown, tag: string | null }[] = [];
      let reads = 0;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
        if (!path.endsWith('/configuration')) {
          return json({ ...RESOURCE, retention: 'temporary', title: null });
        }
        const isLate = timing === 'between the read and write';
        if (options?.method === 'PATCH') {
          writes.push({ body: JSON.parse(String(options.body)), tag: new Headers(options.headers).get('If-Match') });
          if (isLate && writes.length === 1) return json({}, 412);
          finished.resolve();
          return json({});
        }
        reads++;
        if (isLate && reads === 1) return json({ retention: 'temporary', title: null }, 200, { ETag: '"temporary"' });
        return json({ retention: 'persisted', title: isLate ? 'Edited in Library' : null }, 200, { ETag: '"persisted"' });
      };

      await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { year: 2010 }, retention: 'temporary', title: 'Sintel' });
      await finished.promise;
      const first = { body: { title: 'Sintel', year: 2010 }, tag: '"temporary"' };
      const last = { body: { year: 2010 }, tag: '"persisted"' };
      assert.deepEqual(writes, timing === 'between the read and write'
        ? [first, last]
        : [{ body: { title: 'Sintel', year: 2010 }, tag: '"persisted"' }]);
    });
  }

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

  it('rereads a temporary torrent when metadata makes a direct save stale', async () => {
    const tags: Array<string | null> = [];
    let reads = 0;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (options?.method === 'PATCH') {
        tags.push(new Headers(options.headers).get('If-Match'));
        return tags.length === 1 ? json({}, 412) : json({});
      }
      if (path.endsWith('/configuration')) return json({ retention: 'temporary' }, 200, { ETag: `"cfg-${++reads}"` });
      return json({ ...RESOURCE, retention: tags.length > 1 ? 'persisted' : 'temporary' });
    };

    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'persisted', storage: 'file', title: 'Sintel' });

    assert.equal(torrent.retention, 'persisted');
    assert.deepEqual(tags, ['"cfg-1"', '"cfg-2"']);
  });

  it('leaves the configuration and poster alone when another client won the promotion', async () => {
    const requests: string[] = [];
    let readConfiguration = false;
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      requests.push(`${options?.method || 'GET'} ${url.pathname}`);
      if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (url.pathname.endsWith('/configuration')) {
        readConfiguration = true;
        return json({ retention: 'persisted' }, 200, { ETag: '"promoted"' });
      }
      return json({ ...RESOURCE, retention: readConfiguration ? 'persisted' : 'temporary', storage_mode: 'memory', title: 'Edited in Library' });
    };

    const torrent = await TorstApi.addTorrent(INSTANCE, {
      hash: HASH,
      poster: 'https://images.test/sintel.jpg',
      retention: 'persisted',
      storage: 'file',
      title: 'Catalog title',
    });

    assert.equal(torrent.retention, 'persisted');
    assert.equal(torrent.title, 'Edited in Library');
    assert.equal(torrent.storage, 'memory');
    assert.deepEqual(requests, [
      'POST /api/v1/torrents',
      `GET ${TORRENT_PATH}`,
      `GET ${TORRENT_PATH}/configuration`,
      `GET ${TORRENT_PATH}`,
    ]);
  });

  for (const hasPoster of [true, false]) {
    it(`preserves existing metadata and handles a ${hasPoster ? 'stored' : 'missing'} poster on promotion`, async () => {
      const oldTitle = 'Catalog title';
      const oldPoster = hasPoster ? { media_type: 'image/png' } : null;
      let promoted = false;
      let promotion: unknown;
      const uploads: Array<string | null> = [];
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.hostname === 'images.test') return new Response(new Blob(['image'], { type: 'image/jpeg' }));
        if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
        if (options?.method === 'PUT') {
          uploads.push(new Headers(options.headers).get('If-None-Match'));
          return new Response(null, { status: 412 });
        }
        if (options?.method === 'PATCH') {
          promotion = JSON.parse(String(options.body));
          promoted = true;
          return json({});
        }
        if (url.pathname.endsWith('/configuration')) {
          return json({ genres: ['Drama'], retention: 'temporary', title: oldTitle }, 200, { ETag: '"temporary"' });
        }
        return json({ ...RESOURCE, poster: oldPoster, retention: promoted ? 'persisted' : 'temporary', title: oldTitle });
      };

      const torrent = await TorstApi.addTorrent(INSTANCE, {
        hash: HASH,
        library: { genres: ['Animation'], year: 2010 },
        poster: 'https://images.test/sintel.jpg',
        retention: 'persisted',
        title: 'Catalog.Title.1080p',
      });

      assert.equal(torrent.retention, 'persisted');
      assert.equal(torrent.title, oldTitle);
      assert.deepEqual(promotion, { retention: 'persisted', storage_mode: 'memory', year: 2010 });
      assert.deepEqual(uploads, hasPoster ? [] : ['*']);
    });
  }

  it('sends library details for saved and temporary magnets', async () => {
    const library = { description: 'A dragon story.', genres: ['Animation', 'Fantasy'], imdbId: 'tt1727587', kind: 'movie' as const, year: 2010 };
    const bodies: unknown[] = [];
    globalThis.fetch = async (_input, options) => {
      if (options?.method === 'POST') bodies.push(JSON.parse(String(options.body)));
      return json(RESOURCE, options?.method === 'POST' ? 201 : 200);
    };
    await TorstApi.addTorrent(INSTANCE, { hash: HASH, library, title: ' Sintel ' });
    await TorstApi.addTorrent(INSTANCE, { hash: HASH, library, retention: 'temporary', title: 'Sintel' });
    assert.deepEqual(bodies, [
      { description: 'A dragon story.', genres: ['Animation', 'Fantasy'], imdb_id: 'tt1727587', kind: 'movie', magnet_uri: `magnet:?xt=urn:btih:${HASH}`, retention: 'persisted', storage_mode: 'memory', title: 'Sintel', year: 2010 },
      { description: 'A dragon story.', genres: ['Animation', 'Fantasy'], imdb_id: 'tt1727587', kind: 'movie', magnet_uri: `magnet:?xt=urn:btih:${HASH}`, retention: 'temporary', storage_mode: 'memory', title: 'Sintel', year: 2010 },
    ]);
  });

  it('uploads library details as form parts, one part per genre', async () => {
    let form: FormData | undefined;
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.hostname === 'indexer.test') return new Response('d4:infod4:name4:testee');
      if (options?.method === 'POST') form = options.body as FormData;
      return json(RESOURCE, options?.method === 'POST' ? 201 : 200);
    };
    await TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { library: { genres: ['Animation', 'Fantasy'], kind: 'series', year: 2010 }, title: 'Sintel' });
    assert.deepEqual(form?.getAll('genres'), ['Animation', 'Fantasy']);
    assert.equal(form?.get('kind'), 'series');
    assert.equal(form?.get('year'), '2010');
    assert.equal(form?.get('title'), 'Sintel');
  });

  it('saves the torrent without library details Torst refuses', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, options) => {
      if (options?.method !== 'POST') return json(RESOURCE);
      const body = JSON.parse(String(options.body));
      bodies.push(body);
      return body.genres
        ? json({ detail: 'genres[0] is too long', status: 422, type: 'tag:skunkie.github.io,2026:torrplay/problems/validation-failed' }, 422)
        : json(RESOURCE, 201);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { genres: ['Animation'] }, title: 'Sintel' });
    assert.equal(torrent.id, RESOURCE.id);
    assert.deepEqual(bodies.map(body => body.genres), [['Animation'], undefined]);
    assert.equal(bodies[1].title, 'Sintel');
  });

  const longDescription = '🎬'.repeat(4096);
  const contentTooLarge = () => json({
    status: 413,
    title: 'Content too large',
    type: 'tag:skunkie.github.io,2026:torrplay/problems/content-too-large',
  }, 413);
  const exceedsJsonLimit = (body: string) => Buffer.byteLength(body, 'utf8') > 16 * 1024;

  it('creates a temporary magnet with the title alone when catalog details exceed the JSON limit', { timeout: 2000 }, async () => {
    const payloads: string[] = [];
    const attemptedPatch = deferred<unknown>();
    globalThis.fetch = async (_input, init) => {
      if (init?.method === 'GET') return json({ retention: 'temporary', title: 'Sintel' }, 200, { ETag: '"cfg"' });
      const body = String(init?.body);
      if (init?.method === 'PATCH') {
        attemptedPatch.resolve(JSON.parse(body));
        return contentTooLarge();
      }
      payloads.push(body);
      return exceedsJsonLimit(body) ? contentTooLarge() : json({ ...RESOURCE, retention: 'temporary' }, 201);
    };

    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { description: longDescription }, retention: 'temporary', title: 'Sintel' });

    assert.equal(torrent.retention, 'temporary');
    assert.deepEqual(payloads.map(exceedsJsonLimit), [true, false]);
    const fallback = JSON.parse(payloads[1]);
    assert.equal(fallback.title, 'Sintel');
    assert.equal(fallback.description, undefined);
    assert.deepEqual(await attemptedPatch.promise, { description: longDescription });
  });

  for (const descriptionFits of [true, false]) {
    it(`fills smaller metadata groups when the description ${descriptionFits ? 'fits separately' : 'exceeds the limit alone'}`, { timeout: 2000 }, async () => {
      const description = descriptionFits ? '界'.repeat(4096) : longDescription;
      const genres = Array.from({ length: 16 }, (_, index) => `${index}${'界'.repeat(125)}`);
      const configuration: Record<string, unknown> = { description: null, genres: [], retention: 'temporary', title: 'Sintel', year: null };
      const finished = deferred<void>();
      const rejectedPatches: Array<Record<string, unknown>> = [];
      let revision = 0;
      globalThis.fetch = async (_input, init) => {
        const body = String(init?.body ?? '');
        const members = body ? JSON.parse(body) : {};
        if (init?.method === 'POST') {
          return exceedsJsonLimit(body) ? contentTooLarge() : json({ ...RESOURCE, retention: 'temporary' }, 201);
        }
        if (init?.method === 'PATCH') {
          assert.equal(new Headers(init.headers).get('If-Match'), `"cfg-${revision}"`);
          if (exceedsJsonLimit(body)) {
            rejectedPatches.push(members);
            if (rejectedPatches.length === 1) {
              configuration.year = 2026;
              revision++;
            }
            return contentTooLarge();
          }
          Object.assign(configuration, members);
          revision++;
          if (members.genres) finished.resolve();
        }
        return json(configuration, 200, { ETag: `"cfg-${revision}"` });
      };

      await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { description, genres, year: 2010 }, retention: 'temporary', title: 'Sintel' });
      await finished.promise;

      assert.deepEqual(configuration, {
        description: descriptionFits ? description : null,
        genres,
        retention: 'temporary',
        title: 'Sintel',
        year: 2026,
      });
      assert.deepEqual(rejectedPatches, descriptionFits ? [{ description, genres, year: 2010 }] : [{ description, genres, year: 2010 }, { description }]);
    });
  }

  for (const hasDetails of [false, true]) {
    it(`sends just the magnet when the title exceeds the JSON limit ${hasDetails ? 'after removing other metadata' : 'on its own'}`, { timeout: 2000 }, async () => {
      const magnet = `magnet:?xt=urn:btih:${HASH}&dn=${'🎬'.repeat(3300)}`;
      const title = '🎬'.repeat(900);
      const payloads: string[] = [];
      const attemptedPatch = deferred<{ body: unknown, tag: string | null }>();
      const patchResponse = deferred<Response>();
      globalThis.fetch = async (_input, init) => {
        if (init?.method === 'GET') return json({ retention: 'temporary', title: null }, 200, { ETag: '"cfg"' });
        const body = String(init?.body);
        if (init?.method === 'PATCH') {
          attemptedPatch.resolve({ body: JSON.parse(body), tag: new Headers(init.headers).get('If-Match') });
          return patchResponse.promise;
        }
        payloads.push(body);
        return exceedsJsonLimit(body) ? contentTooLarge() : json({ ...RESOURCE, retention: 'temporary' }, 201);
      };

      const torrent = await TorstApi.addTorrent(INSTANCE, {
        library: hasDetails ? { year: 2010 } : undefined,
        magnet,
        retention: 'temporary',
        title,
      });

      assert.equal(torrent.retention, 'temporary');
      assert.deepEqual(payloads.map(exceedsJsonLimit), hasDetails ? [true, true, false] : [true, false]);
      assert.deepEqual(JSON.parse(payloads[payloads.length - 1]), {
        magnet_uri: magnet,
        retention: 'temporary',
        storage_mode: 'memory',
      });
      const patch = await attemptedPatch.promise;
      patchResponse.resolve(json({}));
      assert.deepEqual(patch, { body: hasDetails ? { title, year: 2010 } : { title }, tag: '"cfg"' });
    });
  }

  for (const retention of ['persisted', 'temporary'] as const) {
    it(`keeps the title when a duplicate's ${retention === 'persisted' ? 'promotion' : 'metadata update'} exceeds the JSON limit`, { timeout: 2000 }, async () => {
      const completed = deferred<void>();
      const attemptedDescription = deferred<void>();
      const patches: string[] = [];
      let resourceRetention = 'temporary';
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
        if (init?.method === 'PATCH') {
          const body = String(init.body);
          patches.push(body);
          if (exceedsJsonLimit(body)) {
            if (retention === 'persisted' && resourceRetention === 'persisted') attemptedDescription.resolve();
            return contentTooLarge();
          }
          resourceRetention = retention;
          completed.resolve();
          return json({ retention });
        }
        if (url.pathname.endsWith('/configuration')) {
          return json({ retention: resourceRetention, title: null }, 200, { ETag: '"cfg"' });
        }
        return json({ ...RESOURCE, retention: resourceRetention, title: null });
      };

      await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { description: longDescription }, retention, title: 'Sintel' });
      await completed.promise;

      if (retention === 'persisted') {
        await attemptedDescription.promise;
        assert.deepEqual(patches.map(exceedsJsonLimit), [true, false, true]);
        assert.deepEqual(JSON.parse(patches[2]), { description: longDescription });
      } else {
        assert.deepEqual(patches.map(exceedsJsonLimit), [true, false]);
      }
      assert.deepEqual(JSON.parse(patches[1]), retention === 'persisted'
        ? { retention: 'persisted', storage_mode: 'memory', title: 'Sintel' }
        : { title: 'Sintel' });
    });
  }

  it('fills omitted metadata in smaller patches after a size-limited promotion', { timeout: 2000 }, async () => {
    const description = '界'.repeat(4096);
    const genres = Array.from({ length: 16 }, (_, index) => `${index}${'界'.repeat(125)}`);
    const configuration: Record<string, unknown> = {
      description: null, genres: [], retention: 'temporary', storage_mode: 'memory', title: null, year: null,
    };
    const finishMetadata = deferred<void>();
    const metadataStored = deferred<void>();
    const successfulPatches: Array<Record<string, unknown>> = [];
    let revision = 0;

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = String(init?.body ?? '');
      if (exceedsJsonLimit(body)) return contentTooLarge();
      if (init?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (init?.method === 'PATCH') {
        const members = JSON.parse(body);
        assert.equal(new Headers(init.headers).get('If-Match'), `"cfg-${revision}"`);
        if (!members.retention) {
          assert.equal(configuration.retention, 'persisted');
          await finishMetadata.promise;
        }
        successfulPatches.push(members);
        Object.assign(configuration, members);
        revision++;
        if (configuration.description && configuration.year && Array.isArray(configuration.genres) && configuration.genres.length > 0) {
          metadataStored.resolve();
        }
      }
      return url.pathname.endsWith('/configuration')
        ? json(configuration, 200, { ETag: `"cfg-${revision}"` })
        : json({ ...RESOURCE, ...configuration });
    };

    const torrent = await TorstApi.addTorrent(INSTANCE, {
      hash: HASH, library: { description, genres, year: 2010 }, retention: 'persisted', storage: 'file', title: 'Sintel',
    });

    assert.equal(torrent.retention, 'persisted');
    assert.equal(torrent.storage, 'file');
    assert.deepEqual(successfulPatches, [{ retention: 'persisted', storage_mode: 'disk', title: 'Sintel' }]);
    finishMetadata.resolve();
    await metadataStored.promise;

    assert.deepEqual(configuration, {
      description, genres, retention: 'persisted', storage_mode: 'disk', title: 'Sintel', year: 2010,
    });
    assert.ok(successfulPatches.slice(1).every(patch => !('title' in patch) && !('storage_mode' in patch)));
  });

  it('does not resend a multipart upload that Torst rejects as too large', async () => {
    let uploads = 0;
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).hostname === 'indexer.test') return new Response('torrent file');
      assert.ok(init?.body instanceof FormData);
      uploads++;
      return contentTooLarge();
    };

    await assert.rejects(
      TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { library: { description: 'A synopsis.' }, retention: 'temporary' }),
      (error: unknown) => error instanceof TorstApiError && error.status === 413
    );
    assert.equal(uploads, 1);
  });

  it('does not retry a torrent Torst cannot process', async () => {
    let posts = 0;
    globalThis.fetch = async () => {
      posts++;
      return json({ detail: 'Not a torrent', status: 422, type: 'tag:skunkie.github.io,2026:torrplay/problems/unprocessable-torrent' }, 422);
    };
    await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { kind: 'movie' } }), (error: unknown) => error instanceof TorstApiError && error.status === 422);
    assert.equal(posts, 1);
  });

  it('adds library details while promoting a duplicate temporary torrent', async () => {
    let patch: unknown;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === 'POST') return json({ torrent: TORRENT_PATH }, 409);
      if (path.endsWith('/configuration')) {
        if (options?.method === 'PATCH') patch = JSON.parse(String(options.body));
        return json({ retention: 'temporary' }, 200, { ETag: '"cfg-temp"' });
      }
      return json({ ...RESOURCE, retention: patch ? 'persisted' : 'temporary' });
    };
    await TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { kind: 'series', year: 2015 }, title: 'Caminandes' });
    assert.deepEqual(patch, { kind: 'series', retention: 'persisted', storage_mode: 'memory', title: 'Caminandes', year: 2015 });
  });

  it('maps the media type and episode Torst reports for each file', async () => {
    globalThis.fetch = async input => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === `${TORRENT_PATH}/files`) {
        return json({ items: [
          { ...FILE, episode: { number: 2, season: 1 }, media_type: 'video/x-matroska' },
          { episode: null, id: 'fil_notes', media_type: 'text/plain', path: ['Sintel', 'notes.txt'], size_bytes: 10 },
        ], links: {} });
      }
      return json(RESOURCE);
    };
    const { files } = await TorstApi.getTorrent(INSTANCE, HASH);
    assert.deepEqual(files.map(file => [file.mediaType, file.torstEpisode]), [['video/x-matroska', { number: 2, season: 1 }], ['text/plain', null]]);
  });

  it('streams with a playback token limited to the torrent', async () => {
    const instance: TorstInstance = { ...INSTANCE, accessToken: 'tpa_secret', accessTokenExpiresAtMs: Infinity, authType: 'bearer', id: 'scoped', password: 'secret' };
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/playback-tokens') {
        assert.deepEqual(JSON.parse(String(options?.body)), { torrent_id: RESOURCE.id });
        return json({ expires_at: '2999-01-01T00:00:00Z', token: 'tpp_scoped', torrent_id: RESOURCE.id }, 201);
      }
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === `${TORRENT_PATH}/files`) return json({ items: [FILE], links: {} });
      return json(RESOURCE);
    };
    assert.equal(await TorstApi.getStreamUrl(instance, HASH, { index: 0 }), `${instance.url}${FILE_PATH}/content?token=tpp_scoped`);
  });

  it('reuses an existing persisted torrent for a temporary request without downgrading it', async () => {
    const methods: string[] = [];
    globalThis.fetch = async (_input, options) => {
      methods.push(options?.method || 'GET');
      return options?.method === 'POST' ? json({ torrent: TORRENT_PATH }, 409) : json(RESOURCE);
    };
    const torrent = await TorstApi.addTorrent(INSTANCE, { hash: HASH, poster: 'https://images.test/sintel.jpg', retention: 'temporary', title: 'Sintel' });
    assert.equal(torrent.retention, 'persisted');
    assert.deepEqual(methods, ['POST', 'GET']);
  });

  it('reports a full temporary pool without treating it as a duplicate', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return json({ detail: 'All temporary torrents are streaming', type: 'tag:skunkie.github.io,2026:torrplay/problems/lifecycle-conflict' }, 409);
    };
    await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH, retention: 'temporary' }), (error: unknown) => error instanceof TorstApiError && error.status === 409);
    assert.equal(calls, 1);
  });

  it('does not retry catalog details for an unrelated problem URI ending in validation-failed', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return json({ type: 'https://other.test/problems/validation-failed' }, 422);
    };
    await assert.rejects(TorstApi.addTorrent(INSTANCE, { hash: HASH, library: { kind: 'movie' } }), (error: unknown) => error instanceof TorstApiError && error.status === 422);
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

  for (const isCleanupDelayed of [false, true]) {
    it(`starts another preload without waiting for ${isCleanupDelayed ? 'delayed' : 'failed'} cleanup`, async () => {
      let creationCount = 0;
      let deletionCount = 0;
      let finishCleanup!: (response: Response) => void;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        if (options?.method === 'POST') return json({ completed_bytes: 1024, id: `prl_${++creationCount}`, state: 'ready', target_bytes: 1024 }, 201);
        if (path.endsWith('/preloads/prl_2') && options?.method !== 'DELETE') return json({ completed_bytes: 1024, id: 'prl_2', state: 'ready', target_bytes: 1024 });
        assert.equal(options?.method, 'DELETE');
        deletionCount++;
        if (isCleanupDelayed) return new Promise<Response>(resolve => { finishCleanup = resolve; });
        throw new TypeError('Browser CORS blocked');
      };
      await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      const replacement = TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      await new Promise(resolve => setImmediate(resolve));
      try {
        assert.equal(creationCount, 2, 'creation must not wait for cleanup');
        assert.equal((await replacement).preloadId, 'prl_2');
        assert.equal(deletionCount, 1);
      } finally {
        if (isCleanupDelayed) finishCleanup(new Response(null, { status: 204 }));
        await replacement;
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await TorstApi.getPreload(INSTANCE, HASH, 'prl_1')).status, 'evicted');
      assert.equal((await TorstApi.getPreload(INSTANCE, HASH, 'prl_2')).status, 'ready');
    });
  }

  it('does not inspect or delete a preload already returned as failed', async () => {
    let creationCount = 0;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({});
      assert.equal(options?.method, 'POST', 'a failed preload needs no further cleanup requests');
      const id = `prl_${++creationCount}`;
      return json({ completed_bytes: 0, id, state: creationCount === 1 ? 'failed' : 'ready', target_bytes: 1024 }, 201);
    };
    assert.equal((await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 })).status, 'failed');
    assert.equal((await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 })).preloadId, 'prl_2');
    assert.equal(creationCount, 2);
  });

  for (const state of ['expired', 'failed']) {
    it(`forgets a known ${state} preload on cancellation without sending DELETE`, async () => {
      let deletionCount = 0;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        if (path.endsWith('/statistics')) return json({});
        if (options?.method === 'DELETE') { deletionCount++; throw new TypeError('Browser CORS blocked'); }
        assert.equal(options?.method, 'POST');
        return json({ completed_bytes: 0, id: 'prl_ended', state, target_bytes: 1024 }, 201);
      };
      const ended = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      await TorstApi.cancelPreload(INSTANCE, HASH, ended.preloadId);
      assert.equal(deletionCount, 0);
      assert.deepEqual(await TorstApi.getPreload(INSTANCE, HASH), { status: 'idle' });
    });
  }

  for (const status of [404, 503]) {
    it(`retains the distinction between a missing preload and a failed status read (${status})`, async () => {
      let deletionCount = 0;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        if (options?.method === 'POST') return json({ completed_bytes: 1024, id: 'prl_one', state: 'ready', target_bytes: 1024 }, 201);
        if (options?.method === 'DELETE') { deletionCount++; return new Response(null, { status: 204 }); }
        return new Response(null, { status });
      };
      const preload = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      await assert.rejects(TorstApi.getPreload(INSTANCE, HASH, preload.preloadId), (error: unknown) => error instanceof TorstApiError && error.status === status);
      await TorstApi.cancelPreload(INSTANCE, HASH, preload.preloadId);
      assert.equal(deletionCount, status === 404 ? 0 : 1);
      assert.deepEqual(await TorstApi.getPreload(INSTANCE, HASH), { status: 'idle' });
    });
  }

  it('preserves ownership after cleanup fails and Torst rejects the replacement at its resource limit', async () => {
    let creationCount = 0;
    const deletedPreloadPaths: string[] = [];
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (options?.method === 'POST') return ++creationCount === 1
        ? json({ completed_bytes: 1024, id: 'prl_first', state: 'ready', target_bytes: 1024 }, 201)
        : new Response(null, { status: 409 });
      assert.equal(options?.method, 'DELETE');
      deletedPreloadPaths.push(path);
      if (deletedPreloadPaths.length === 1) throw new TypeError('Browser CORS blocked');
      return new Response(null, { status: 204 });
    };
    const first = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    await assert.rejects(TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 }), (error: unknown) => error instanceof TorstApiError && error.status === 409);
    assert.deepEqual(deletedPreloadPaths, [`${FILE_PATH}/preloads/prl_first`]);
    await TorstApi.cancelPreload(INSTANCE, HASH, first.preloadId);
    assert.deepEqual(deletedPreloadPaths, [`${FILE_PATH}/preloads/prl_first`, `${FILE_PATH}/preloads/prl_first`]);
  });

  for (const concurrent of [false, true]) {
    it(`continues another file after superseded preload cleanup fails (${concurrent ? 'concurrent' : 'sequential'} calls)`, async () => {
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
          if (id === 'prl_1') throw new TypeError('Browser CORS blocked');
          active.delete(id);
          return new Response(null, { status: 204 });
        }
        if (path.includes('/preloads/') && (!options?.method || options.method === 'GET')) {
          return json({ completed_bytes: 1024, id: path.split('/').pop(), state: 'ready', target_bytes: 1024 });
        }
        assert.equal(options?.method, 'POST');
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
      assert.deepEqual(Array.from(active), ['prl_1', 'prl_2'], 'a late cancellation must not cancel the replacement');
      assert.equal((await TorstApi.getPreload(INSTANCE, HASH, first.preloadId)).status, 'evicted');
      await TorstApi.cancelPreload(INSTANCE, HASH, second.preloadId);
      assert.deepEqual(Array.from(active), ['prl_1']);
    });
  }

  it('attempts preceding torrent cleanup only on the same instance', async () => {
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
      if (url.pathname.includes('/preloads/') && (!options?.method || options.method === 'GET')) {
        return json({ completed_bytes: 1024, id: url.pathname.split('/').pop(), state: 'ready', target_bytes: 1024 });
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
      let payload: { expires_in_seconds: number, offset_bytes?: number } | undefined;
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
        ? { expires_in_seconds: 300, offset_bytes: Math.floor(1024 * fraction) }
        : { expires_in_seconds: 300 });
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
      : json({ facets: { categories: [{ count: 1, name: 'Animation' }], total_count: 1, version: 'test' }, items: [RESOURCE], links: {} }, 200, { ETag: '"listing"' });
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
      return json({ background_downloads_enabled: true });
    };
    const first = TorstApi.getSettings(instance);
    const second = TorstApi.getSettings(instance);
    await first;
    finish(new Response(null, { status: 401 }));
    await second;
    assert.equal(loginCalls, 1);
    assert.equal(instance.accessToken, 'fresh');
  });

  it('uploads a downloaded torrent within Torst\'s metainfo limit', async () => {
    (globalThis as any).Lampa = {
      Platform: { is: () => true },
      Reguest: class {
        public timeout() {}
        public native(_url: string, success: (body: string) => void, _failure: unknown, _body: unknown, params: any) {
          assert.equal(params.dataType, 'text');
          success(JSON.stringify({ ...RESOURCE, file_count: null }));
        }
      },
    };
    let uploadedBytes = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'indexer.test') return new Response(new Uint8Array(33 * 1024 * 1024));
      if (url.pathname === '/api/v1/torrents' && init?.method === 'POST') {
        uploadedBytes = ((init.body as FormData).get('metainfo') as Blob).size;
        return json(RESOURCE, 201);
      }
      return json({ ...RESOURCE, file_count: null });
    };
    await TorstApi.resolveTorrent(INSTANCE, 'https://indexer.test/sintel.torrent', { retention: 'temporary' });
    assert.equal(uploadedBytes, 33 * 1024 * 1024);
  });

  it('rejects an oversized downloaded torrent before uploading it', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(new Uint8Array(33 * 1024 * 1024 + 1)); };
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
    let creationCount = 0;
    let statusReadCount = 0;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({});
      if (options?.method === 'DELETE') assert.fail('An expired preload has already released its reservations');
      if (options?.method === 'POST') {
        payloads.push(JSON.parse(String(options.body)));
        return json({ completed_bytes: 256, id: `prl_${++creationCount}`, state: 'downloading', target_bytes: 1024 }, 201);
      }
      assert.equal(++statusReadCount, 1, 'an expired preload should not be read again before renewal');
      return json({ completed_bytes: 512, id: 'prl_1', state: 'expired', target_bytes: 1024 });
    };
    const started = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0, playbackFraction: 0.5 });
    const renewed = await TorstApi.getPreload(INSTANCE, HASH, started.preloadId);
    assert.equal(renewed.preloadId, 'prl_2');
    assert.equal(renewed.status, 'preloading');
    assert.deepEqual(payloads, [{ expires_in_seconds: 300, offset_bytes: 512 }, { expires_in_seconds: 300, offset_bytes: 512 }]);
  });

  it('does not return ready from an older read after a preload is known to have failed', async () => {
    let statusReadCount = 0;
    let finishOlderRead!: (response: Response) => void;
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (path.endsWith('/statistics')) return json({});
      if (options?.method === 'POST') return json({ completed_bytes: 1024, id: 'prl_one', state: 'ready', target_bytes: 1024 }, 201);
      if (++statusReadCount === 1) return new Promise<Response>(resolve => { finishOlderRead = resolve; });
      return json({ completed_bytes: 1024, id: 'prl_one', state: 'failed', target_bytes: 1024 });
    };
    const preload = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    const olderRead = TorstApi.getPreload(INSTANCE, HASH, preload.preloadId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await TorstApi.getPreload(INSTANCE, HASH, preload.preloadId)).status, 'failed');
    finishOlderRead(json({ completed_bytes: 1024, id: 'prl_one', state: 'ready', target_bytes: 1024 }));
    assert.deepEqual(await olderRead, { status: 'evicted' });
  });

  for (const endReason of ['failure', 'cancellation']) {
    it(`discards active status after ${endReason} while transfer statistics are loading`, async () => {
      let statisticsReadCount = 0;
      let hasFailed = false;
      let finishStatistics!: (response: Response) => void;
      globalThis.fetch = async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
        if (path === TORRENT_PATH) return json(RESOURCE);
        if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
        if (options?.method === 'DELETE') return new Response(null, { status: 204 });
        if (path.endsWith('/statistics')) {
          if (++statisticsReadCount === 2) return new Promise<Response>(resolve => { finishStatistics = resolve; });
          return json({});
        }
        return json({ completed_bytes: 256, id: 'prl_one', state: hasFailed ? 'failed' : 'downloading', target_bytes: 1024 }, options?.method === 'POST' ? 201 : 200);
      };
      const preload = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
      const olderRead = TorstApi.getPreload(INSTANCE, HASH, preload.preloadId);
      await new Promise(resolve => setImmediate(resolve));
      if (endReason === 'failure') {
        hasFailed = true;
        assert.equal((await TorstApi.getPreload(INSTANCE, HASH, preload.preloadId)).status, 'failed');
      } else await TorstApi.cancelPreload(INSTANCE, HASH, preload.preloadId);
      finishStatistics(json({}));
      assert.deepEqual(await olderRead, { status: 'evicted' });
    });
  }

  it('does not renew a superseded preload whose status arrives late', async () => {
    let creationCount = 0;
    let statusReadCount = 0;
    let complete: (response: Response) => void = () => {};
    globalThis.fetch = async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/torrents') return json({ items: [RESOURCE], links: {} });
      if (path === TORRENT_PATH) return json(RESOURCE);
      if (path.endsWith('/files')) return json({ items: [FILE], links: {} });
      if (options?.method === 'POST') return json({ completed_bytes: 1024, id: `prl_${++creationCount}`, state: 'ready', target_bytes: 1024 }, 201);
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (++statusReadCount > 1) return json({ completed_bytes: 1024, id: 'prl_1', state: 'ready', target_bytes: 1024 });
      return new Promise(resolve => { complete = resolve; });
    };
    const first = await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    const pending = TorstApi.getPreload(INSTANCE, HASH, first.preloadId);
    await new Promise(resolve => setImmediate(resolve));
    await TorstApi.startPreload(INSTANCE, HASH, { file_index: 0 });
    complete(json({ completed_bytes: 1024, id: first.preloadId, state: 'expired', target_bytes: 1024 }));
    assert.deepEqual(await pending, { status: 'evicted' });
    assert.equal(creationCount, 2);
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
