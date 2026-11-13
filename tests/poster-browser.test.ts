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

it('stores an exact binary poster through Android without CORS headers', async t => {
  let completeResult!: (result: { error?: string, torrentSaved?: boolean }) => void;
  const resultReady = new Promise<{ error?: string, torrentSaved?: boolean }>(resolve => { completeResult = resolve; });
  const requests: string[] = [];
  let posterStored = false;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const api = createServer(async (req, res) => {
    requests.push(req.method + ' ' + req.url);
    if (req.url === '/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/torrents') {
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        file_count: 0,
        id: 'trr_one',
        info_hashes: [{ algorithm: 'sha1', value: 'a'.repeat(40) }],
        name: 'Sintel',
        observed_state: 'downloading',
        poster: null,
        retention: 'persisted',
        size_bytes: 1,
        storage_mode: 'memory',
      }));
      return;
    }
    if (req.method === 'PUT' && (req.url || '').endsWith('/poster')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      posterStored = Buffer.concat(chunks).equals(png) && req.headers['content-type'] === 'image/png';
      res.writeHead(201).end();
      return;
    }
    res.writeHead(req.method === 'OPTIONS' ? 405 : 404).end();
  });
  t.after(() => stopServer(api));
  const apiOrigin = await startServer(api);
  const bundle = await build({ bundle: true, format: 'iife', stdin: { contents: `
  import { TorstApi } from './src/api/torst';
  globalThis.AndroidJS = { supportsHttpBodyEncoding: encoding => encoding === 'base64' };
  globalThis.Lampa = { Platform: { is: name => name === 'android' }, Reguest: class {
   timeout() {}
   native(url, success, failure, body, params) {
    fetch('/native', { body: JSON.stringify({ body, bodyEncoding: params.bodyEncoding, dataType: params.dataType, headers: params.headers, method: params.type, returnHeaders: params.returnHeaders, url }), method: 'POST' })
      .then(response => response.json())
      .then(response => response.status >= 400 ? failure({ status: response.status }) : success(response.body))
      .catch(() => failure({ status: 0 }));
   }
   silent() { throw new Error('Unexpected ajax request'); }
  }};
  TorstApi.addTorrent({ authType: 'none', id: 'one', name: 'One', url: ${JSON.stringify(apiOrigin)} }, { hash: 'a'.repeat(40), poster: ${JSON.stringify(apiOrigin + '/image.png')} })
    .then(torrent => ({ torrentSaved: torrent.id === 'trr_one' }))
    .catch(error => ({ error: error.message }))
    .then(result => fetch('/result', { body: JSON.stringify(result), method: 'POST' }));
  `, resolveDir: process.cwd() }, target: ['chrome79'], write: false });
  const page = createServer(async (req, res) => {
    if (req.url === '/result') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(204).end();
      completeResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return;
    }
    if (req.url === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].text);
      return;
    }
    if (req.url === '/native') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const response = await fetch(data.url, { body: data.bodyEncoding === 'base64' ? Buffer.from(data.body, 'base64') : data.body || undefined, headers: data.headers, method: data.method });
      const bytes = Buffer.from(await response.arrayBuffer());
      const body = data.dataType === 'base64' ? bytes.toString('base64') : bytes.toString('utf8');
      const envelope = { body, encoding: data.dataType === 'base64' ? 'base64' : undefined, headers: Object.fromEntries(response.headers) };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ body: data.returnHeaders ? JSON.stringify(envelope) : body, status: response.status }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><script src="/client.js"></script>');
  });
  t.after(() => stopServer(page));
  const directory = await mkdtemp(join(tmpdir(), 'torst-poster-repro-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  try {
    const pageOrigin = await startServer(page);
    const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--user-data-dir=' + directory, pageOrigin], { timeout: 30000 });
    const closed = new Promise<void>(resolve => { chrome.once('close', () => resolve()); });
    let stderr = '';
    chrome.stdout.resume();
    chrome.stderr.on('data', chunk => { stderr += String(chunk); });
    const failed = new Promise<never>((_resolve, reject) => {
      chrome.on('error', reject);
      chrome.on('close', (code, signal) => reject(new Error(`Chrome exited before reporting a result (${code}, ${signal}): ${stderr}`)));
    });
    try {
      assert.deepEqual(await Promise.race([resultReady, failed]), { torrentSaved: true });
    } finally {
      chrome.kill();
      await closed;
    }
    assert.equal(posterStored, true);
    assert.ok(requests.includes('PUT /api/v1/torrents/trr_one/poster'));
    assert.ok(!requests.includes('OPTIONS /api/v1/torrents/trr_one/poster'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') t.skip('Chrome is unavailable');
    else throw error;
  }
});
