// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

import { build } from 'esbuild';

async function startServer(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', handleError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

for (const canSendExplicitMethods of [true, false]) {
  it(`starts another preload while the previous one is active (${canSendExplicitMethods ? 'explicit methods' : 'GET/POST bridge'})`, async t => {
    const mutations: string[] = [];
    const activePreloads = new Set<string>();
    let preloadCount = 0;
    const api = createServer((request, response) => {
      const requestPath = new URL(request.url || '/', 'http://torst.test').pathname;
      const sendJson = (value: unknown) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
      if (request.method === 'OPTIONS') response.writeHead(405).end();
      else if (requestPath === '/readyz') response.end('ready');
      else if (request.method === 'GET' && requestPath === '/api/v1/torrents/trr_one') sendJson({
        file_count: 1,
        id: 'trr_one',
        info_hashes: [{ algorithm: 'sha1', value: 'a'.repeat(40) }],
        name: 'Sintel',
        observed_state: 'downloading',
        retention: 'persisted',
        size_bytes: 1024,
        storage_mode: 'memory',
      });
      else if (request.method === 'GET' && requestPath.includes('/preloads/')) {
        sendJson({ completed_bytes: 16, id: requestPath.split('/').pop(), state: 'ready', target_bytes: 16 });
      }
      else if (request.method === 'GET' && requestPath.endsWith('/files')) sendJson({ items: [{ id: 'fil_one', path: ['Sintel.mkv'], size_bytes: 1024 }], links: {} });
      else {
        mutations.push(request.method || '');
        if (request.method === 'DELETE') response.writeHead(activePreloads.delete(requestPath) ? 204 : 404).end();
        else if (request.method === 'POST' && requestPath.endsWith('/preloads')) {
          if (activePreloads.size >= 4) { response.writeHead(409).end(); return; }
          const id = `prl_${++preloadCount}`;
          activePreloads.add(`${requestPath}/${id}`);
          sendJson({ completed_bytes: 16, id, state: 'ready', target_bytes: 16 });
        }
        else if (request.method === 'PUT' && requestPath.endsWith('/progress/fil_one')) {
          void (async () => {
            let body = '';
            for await (const chunk of request) body += String(chunk);
            sendJson({ ...JSON.parse(body), file_id: 'fil_one', updated_at: '2026-11-01T10:00:00Z' });
          })().catch(() => response.writeHead(500).end());
        } else response.writeHead(404).end();
      }
    });
    t.after(() => stopServer(api));
    const apiOrigin = await startServer(api);
    const bundle = await build({
      bundle: true,
      format: 'iife',
      stdin: {
        contents: `
        import { requestHttp } from './src/api/http-client';
        import { TorstApi } from './src/api/torst';
        const apiOrigin = ${JSON.stringify(apiOrigin)};
        const canSendExplicitMethods = ${JSON.stringify(canSendExplicitMethods)};
        const progressUrl = apiOrigin + '/api/v1/profiles/prf_one/torrents/trr_one/progress/fil_one';
        const preloadUrl = apiOrigin + '/api/v1/torrents/trr_one/files/fil_one/preloads/prl_1';
        function createRequestClass(canSendExplicitMethods) {
          return class {
            timeout() {}
            native(url, success, failure, body, params) {
              const method = canSendExplicitMethods ? params.type : body ? 'POST' : 'GET';
              fetch('/native', { method: 'POST', body: JSON.stringify({ body, headers: params.headers, method, url }) })
                .then(response => response.json())
                .then(response => response.status >= 400 ? failure(response) : success(response.body))
                .catch(() => failure({ status: 0 }));
            }
            silent(url, success, failure, body, params) {
              fetch(url, { body: body || undefined, headers: params.headers, method: params.type })
                .then(async response => response.ok ? success(await response.text()) : failure({ status: response.status }))
                .catch(() => failure({ status: 0 }));
            }
          };
        }
        (async () => {
          let isBrowserBlocked = false;
          try { await fetch(progressUrl, { body: '{}', method: 'PUT' }); }
          catch { isBrowserBlocked = true; }
          globalThis.Lampa = { Platform: { is: name => name === 'android' }, Reguest: createRequestClass(canSendExplicitMethods) };
          const instance = { authType: 'none', id: 'one', name: 'One', ...(canSendExplicitMethods ? { profileId: 'prf_one' } : {}), url: apiOrigin };
          await TorstApi.startPreload(instance, 'trr_one', { file_index: 0 });
          const progress = canSendExplicitMethods ? await TorstApi.saveFileProgress(instance, 'prf_one', 'trr_one', 'fil_one', { duration_seconds: 400, position_seconds: 140, viewed: false }) : undefined;
          const nextPreload = await TorstApi.startPreload(instance, 'trr_one', { file_index: 0 });
          globalThis.Lampa.Reguest = createRequestClass(false);
          let isLegacyBlocked = false;
          try { await requestHttp(preloadUrl, { method: 'DELETE' }); }
          catch { isLegacyBlocked = true; }
          return { isBrowserBlocked, isLegacyBlocked, positionSeconds: progress?.position_seconds ?? null, preloadStatus: nextPreload.status };
        })().then(result => document.getElementById('result').textContent = JSON.stringify(result))
          .catch(error => document.getElementById('result').textContent = JSON.stringify({ error: error.message }));
      `,
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      target: ['chrome79'],
      write: false,
    });
    const page = createServer((request, response) => {
      if (request.url === '/client.js') response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].text);
      else if (request.url === '/native') {
        void (async () => {
          let text = '';
          for await (const chunk of request) text += String(chunk);
          const nativeRequest = JSON.parse(text) as { body: false | string, headers: Record<string, string>, method: string, url: string };
          const nativeResponse = await fetch(nativeRequest.url, { body: nativeRequest.body || undefined, headers: nativeRequest.headers, method: nativeRequest.method });
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ body: await nativeResponse.text(), status: nativeResponse.status }));
        })().catch(() => response.writeHead(500).end());
      } else response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><pre id="result"></pre><script src="/client.js"></script>');
    });
    const directory = await mkdtemp(join(tmpdir(), 'torst-http-browser-'));
    try {
      const pageOrigin = await startServer(page);
      const output = await new Promise<string>((resolve, reject) => {
        const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
          '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
          `--user-data-dir=${directory}`, '--virtual-time-budget=10000', '--dump-dom', pageOrigin,
        ], { timeout: 30_000 });
        let stdout = '';
        let stderr = '';
        chrome.stdout.on('data', chunk => { stdout += String(chunk); });
        chrome.stderr.on('data', chunk => { stderr += String(chunk); });
        chrome.on('error', reject);
        chrome.on('close', (code, signal) => code === 0 ? resolve(stdout) : reject(new Error(`Chrome exited with code ${code} and signal ${signal}: ${stderr}`)));
      });
      const result = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      assert.ok(result, 'Chrome must finish the cross-origin transport checks');
      assert.deepEqual(JSON.parse(result), { isBrowserBlocked: true, isLegacyBlocked: true, positionSeconds: canSendExplicitMethods ? 140 : null, preloadStatus: 'ready' });
      assert.deepEqual(mutations.slice().sort(), canSendExplicitMethods ? ['DELETE', 'POST', 'POST', 'PUT'] : ['POST', 'POST']);
      assert.deepEqual([...activePreloads], canSendExplicitMethods
        ? ['/api/v1/torrents/trr_one/files/fil_one/preloads/prl_2']
        : ['/api/v1/torrents/trr_one/files/fil_one/preloads/prl_1', '/api/v1/torrents/trr_one/files/fil_one/preloads/prl_2']);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') t.skip('Chrome is unavailable');
      else throw error;
    } finally {
      await Promise.all([stopServer(page), rm(directory, { force: true, recursive: true })]);
    }
  });
}
