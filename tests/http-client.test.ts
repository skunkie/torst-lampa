// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { isNetworkError, NetworkError, requestHttp } from '../src/api/http-client';

function createAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

describe('HTTP Client (requestHttp)', () => {
  const originalFetch = globalThis.fetch;
  const originalLampa = (globalThis as any).Lampa;

  beforeEach(() => {
    delete (globalThis as any).Lampa;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLampa) {
      (globalThis as any).Lampa = originalLampa;
    } else {
      delete (globalThis as any).Lampa;
    }
  });

  it('preserves binary downloads and their media type', async () => {
    const bytes = new Uint8Array([0, 128, 255, 13, 10]);
    globalThis.fetch = async () => new Response(bytes, { headers: { 'Content-Type': 'application/x-bittorrent' } });
    (globalThis as any).Lampa = { Reguest: class { constructor() { throw new Error('Binary data requires fetch'); } } };
    const response = await requestHttp('http://indexer.test/sintel.torrent', { responseType: 'blob' });
    const blob = await response.blob();
    assert.equal(blob.type, 'application/x-bittorrent');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  });

  it('times out a stalled binary response body', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.fetch = async (_input, options) => ({
      blob: () => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
      }),
    }) as Response;
    try {
      const download = requestHttp('http://indexer.test/sintel.torrent', { responseType: 'blob', timeoutMs: 1000 });
      await new Promise(resolve => setImmediate(resolve));
      const failure = assert.rejects(download, (error: Error) => error.name === 'AbortError');
      mock.timers.tick(1000);
      await failure;
    } finally {
      mock.timers.reset();
    }
  });

  it('uses fetch for real mutations if a native-only wrapper has no ajax transport', async () => {
    (globalThis as any).Lampa = { Reguest: class { public timeout() {} public native() { throw new Error('Incorrect native verb'); } } };
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.method, 'DELETE');
      return new Response(null, { status: 204 });
    };
    assert.equal((await requestHttp('http://instance.test/api/v1/torrents/trr_test', { method: 'DELETE' })).status, 204);
  });

  it('uses fetch fallback when Lampa.Reguest is absent', async () => {
    let capturedRequestUrl = '';
    let capturedRequestOptions: RequestInit | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequestUrl = String(input);
      capturedRequestOptions = init;
      return new Response(JSON.stringify({ hello: 'world' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
        statusText: 'OK',
      });
    };

    const response = await requestHttp('http://127.0.0.1:8080/readyz', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      method: 'GET',
    });

    assert.equal(capturedRequestUrl, 'http://127.0.0.1:8080/readyz');
    assert.equal(capturedRequestOptions?.method, 'GET');
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(response.statusText, 'OK');
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { hello: 'world' });
    const responseText = await response.text();
    assert.equal(responseText, JSON.stringify({ hello: 'world' }));
  });

  it('does not re-issue an aborted request on the silent transport', async () => {
    let silentCallCount = 0;

    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public clear() {}
      // Never calls back, standing in for a native bridge call still in flight.
      public native(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void,
        _requestBody: any,
        _requestOptions: any
      ) {}
      public silent(
        _url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void,
        _requestBody: any,
        _requestOptions: any
      ) {
        silentCallCount += 1;
        onSuccess(JSON.stringify({ status: 'healthy' }));
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    const controller = new AbortController();
    const pendingRequest = requestHttp('http://127.0.0.1:8080/readyz', {
      method: 'GET',
      signal: controller.signal,
      timeoutMs: 50000,
    });
    setTimeout(() => controller.abort(), 5);

    await assert.rejects(pendingRequest, (error: Error) => error.name === 'AbortError');
    assert.equal(silentCallCount, 0);
  });

  it('delegates to Lampa.Reguest when available', async () => {
    let configuredTimeoutMs = 0;
    let capturedSilentCall: any = null;

    class MockReguest {
      public timeout(timeoutMs: number) {
        configuredTimeoutMs = timeoutMs;
      }
      public silent(
        url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void,
        requestBody: any,
        requestOptions: any
      ) {
        capturedSilentCall = { requestBody, requestOptions, url };
        onSuccess(JSON.stringify({ status: 'healthy' }));
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    const response = await requestHttp('http://127.0.0.1:8080/readyz', {
      body: JSON.stringify({ test: 123 }),
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      method: 'POST',
      timeoutMs: 5000,
    });

    assert.equal(configuredTimeoutMs, 5000);
    assert.equal(capturedSilentCall.url, 'http://127.0.0.1:8080/readyz');
    assert.equal(capturedSilentCall.requestBody, JSON.stringify({ test: 123 }));
    assert.equal(capturedSilentCall.requestOptions.type, 'POST');
    assert.equal(capturedSilentCall.requestOptions.crossDomain, true);
    assert.equal(capturedSilentCall.requestOptions.contentType, 'application/json');

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(response.statusText, 'OK');
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { status: 'healthy' });
  });

  it('synthesizes status 204 No Content for empty bodies on Lampa.Reguest success path', async () => {
    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public silent(
        _url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void
      ) {
        onSuccess('');
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/preload');
    assert.equal(response.ok, true);
    assert.equal(response.status, 204);
    assert.equal(response.statusText, 'No Content');
    const responseText = await response.text();
    assert.equal(responseText, '');
  });

  it('synthesizes status 304 Not Modified for an empty answer to a conditional request', async () => {
    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public silent(
        _url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void
      ) {
        onSuccess('');
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    for (const headerName of ['If-None-Match', 'if-none-match']) {
      const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents', {
        headers: { [headerName]: 'W/"v1"' },
      });
      assert.equal(response.ok, false);
      assert.equal(response.status, 304);
      assert.equal(response.statusText, 'Not Modified');
    }
  });

  it('reports a 304 from the Lampa.Reguest reject callback', async () => {
    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public silent(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        onFailure: (error: any) => void
      ) {
        onFailure({ responseText: '', status: 304, statusText: 'Not Modified' });
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents', {
      headers: { 'If-None-Match': 'W/"v1"' },
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 304);
  });

  it('passes a 304 through the fetch fallback', async () => {
    let sentHeaders: HeadersInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders = init?.headers;
      return new Response(null, { status: 304 });
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents', {
      headers: { 'If-None-Match': 'W/"v1"' },
    });
    assert.deepEqual(sentHeaders, { 'If-None-Match': 'W/"v1"' });
    assert.equal(response.ok, false);
    assert.equal(response.status, 304);
  });

  it('handles HTTP error status from Lampa.Reguest reject callback', async () => {
    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public silent(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        onFailure: (error: any) => void
      ) {
        onFailure({
          responseText: JSON.stringify({ error: 'not found' }),
          status: 404,
          statusText: 'Not Found',
        });
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents/unknown');
    assert.equal(response.ok, false);
    assert.equal(response.status, 404);
    assert.equal(response.statusText, 'Not Found');
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { error: 'not found' });
  });

  it('rejects on network error (status 0) from Lampa.Reguest', async () => {
    class MockReguest {
      public timeout(_timeoutMs: number) {}
      public silent(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        onFailure: (error: any) => void
      ) {
        onFailure({
          responseText: '',
          status: 0,
        });
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };

    await assert.rejects(
      async () => {
        await requestHttp('http://127.0.0.1:8080/readyz');
      },
      /Network error/
    );
  });

  it('cancels Lampa.Reguest when the caller aborts the request', async () => {
    let clearCount = 0;

    class MockReguest {
      public clear() {
        clearCount++;
      }
      public native() {}
      public timeout(_timeoutMs: number) {}
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguest,
    };
    const controller = new AbortController();
    const request = requestHttp('http://127.0.0.1:8080/readyz', {
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(request, error => (
      error instanceof Error && error.name === 'AbortError'
    ));
    assert.equal(clearCount, 1);
  });

  it('delegates to Lampa.Reguest.native when available', async () => {
    let capturedNativeCall: any = null;

    class MockReguestWithNative {
      public timeout(_timeoutMs: number) {}
      public native(
        url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void,
        requestBody: any,
        requestOptions: any
      ) {
        capturedNativeCall = { requestBody, requestOptions, url };
        onSuccess(JSON.stringify({ status: 'ok' }));
      }
      public silent() {
        throw new Error('Should not call silent when native is available');
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguestWithNative,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents', {
      method: 'POST',
    });

    assert.equal(capturedNativeCall.url, 'http://127.0.0.1:8080/api/v1/torrents');
    assert.equal(capturedNativeCall.requestBody, '{}');
    assert.equal(capturedNativeCall.requestOptions.type, 'POST');
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: 'ok' });
  });

  it('sends mutations through ajax with their real verbs when the native bridge is available', async () => {
    const calls: Array<{ body: unknown, params: any }> = [];
    (globalThis as any).Lampa = {
      Reguest: class {
        public timeout() {}
        public native() { throw new Error('The bridge cannot send these verbs'); }
        public silent(_url: string, success: any, _failure: any, body: unknown, params: any) {
          calls.push({ body, params });
          success('{}');
        }
      },
    };
    await requestHttp('http://localhost:8080/api/v1/settings', { body: '{"background_downloads":false}', method: 'PATCH' });
    await requestHttp('http://localhost:8080/api/v1/torrents/trr_test', { method: 'DELETE' });
    assert.deepEqual(calls.map(call => call.params.type), ['PATCH', 'DELETE']);
    assert.deepEqual(calls.map(call => call.params.headers), [{}, {}]);
    assert.equal(calls[1].body, false);
  });

  it('uses a header-capable transport when the caller needs an ETag', async () => {
    (globalThis as any).Lampa = { Reguest: class { constructor() { throw new Error('Headers unavailable'); } } };
    globalThis.fetch = async () => new Response('{}', { headers: { ETag: '"cfg-test"' } });
    const response = await requestHttp('http://localhost:8080/api/v1/settings', { needsResponseHeaders: true });
    assert.equal(response.headers?.get('ETag'), '"cfg-test"');
  });

  it('sends the real PUT/DELETE verb (no override) through the ajax fallback transport', async () => {
    let capturedSilentCall: any = null;

    // The fallback only runs when native() throws/hangs outright (e.g. no bridge
    // present), not when it resolves with an error status like the 404 a
    // mis-routed POST would get — that resolved response is returned as-is.
    class MockReguestNativeThrows {
      public timeout(_timeoutMs: number) {}
      public native() {
        throw new Error('native bridge unavailable');
      }
      public silent(
        url: string,
        onSuccess: (responseBody: any) => void,
        _onFailure: (error: any) => void,
        requestBody: any,
        requestOptions: any
      ) {
        capturedSilentCall = { requestBody, requestOptions, url };
        onSuccess(JSON.stringify({ status: 'ready' }));
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguestNativeThrows,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/settings', {
      body: JSON.stringify({ background_downloads: false }),
      method: 'PUT',
    });

    assert.equal(capturedSilentCall.requestOptions.type, 'PUT');
    assert.equal(capturedSilentCall.requestOptions.headers['X-HTTP-Method-Override'], undefined);
    assert.equal(response.ok, true);
  });

  it('does not repeat a mutating native request through silent after an asynchronous failure', async () => {
    let silentCallCount = 0;

    class MockReguestNativeFailsAsynchronously {
      public timeout(_timeoutMs: number) {}
      public native(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        onFailure: (error: any) => void
      ) {
        queueMicrotask(() => onFailure({ status: 0 }));
      }
      public silent() {
        silentCallCount++;
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguestNativeFailsAsynchronously,
    };

    await assert.rejects(
      requestHttp('http://127.0.0.1:8080/api/v1/torrents/abcdef', {
        method: 'POST',
      }),
      /Network error/
    );
    assert.equal(silentCallCount, 0);
  });

  it('aborts the fetch fallback when the caller aborts the request', async () => {
    let forwardedSignal: AbortSignal | undefined;

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
      });
    };

    const controller = new AbortController();
    const pendingRequest = requestHttp('http://127.0.0.1:8080/api/v1/torrents', { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();

    await assert.rejects(pendingRequest, (error: Error) => error.name === 'AbortError');
    // The fallback wraps the caller's signal in its own controller so the timeout and the
    // caller can each cancel the same request; the wrapper is what fetch must receive.
    assert.notEqual(forwardedSignal, controller.signal);
    assert.equal(forwardedSignal?.aborted, true);
  });

  it('rejects without issuing a request when the signal is already aborted', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = async () => {
      fetchCallCount += 1;
      return new Response('{}', { status: 200 });
    };

    await assert.rejects(
      requestHttp('http://127.0.0.1:8080/api/v1/torrents', { signal: AbortSignal.abort() }),
      (error: Error) => error.name === 'AbortError'
    );
    assert.equal(fetchCallCount, 0);
  });

  it('handles Android bridge error format ({ status: 401, message: "..." })', async () => {
    class MockReguestWithNative {
      public timeout(_timeoutMs: number) {}
      public native(
        _url: string,
        _onSuccess: (responseBody: any) => void,
        onFailure: (error: any) => void
      ) {
        onFailure({
          message: 'request error: Invalid response from server: 401 Unauthorized',
          status: 401,
        });
      }
    }

    (globalThis as any).Lampa = {
      Reguest: MockReguestWithNative,
    };

    const response = await requestHttp('http://127.0.0.1:8080/api/v1/torrents');
    assert.equal(response.ok, false);
    assert.equal(response.status, 401);
    assert.equal(response.statusText, 'request error: Invalid response from server: 401 Unauthorized');
    const responseText = await response.text();
    assert.equal(responseText, 'request error: Invalid response from server: 401 Unauthorized');
  });
});

describe('HTTP Client (isNetworkError)', () => {
  const originalFetch = globalThis.fetch;
  const originalLampa = (globalThis as any).Lampa;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLampa) (globalThis as any).Lampa = originalLampa;
    else delete (globalThis as any).Lampa;
  });

  it('reports a fetch connection failure as a network error', async () => {
    delete (globalThis as any).Lampa;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const error = await requestHttp('http://first.local/readyz', { method: 'GET' })
      .then(() => undefined, (rejection: unknown) => rejection);
    assert.equal(isNetworkError(error), true);
    assert.equal((error as Error).message, 'Failed to fetch');
  });

  it('recognizes failures where the server never answered', () => {
    assert.equal(isNetworkError(Object.assign(new Error('Request aborted'), { name: 'AbortError' })), true);
    assert.equal(isNetworkError(new NetworkError('Network error (http://first.local)')), true);
  });

  it('reports Lampa transport failures without an HTTP status, and timeouts, as network errors', async () => {
    for (const shouldHang of [false, true]) {
      class MockReguest {
        public timeout(_timeoutMs: number) {}
        public clear() {}
        public silent(
          _url: string,
          _onSuccess: (responseBody: any) => void,
          onFailure: (error: any) => void
        ) {
          if (!shouldHang) onFailure({ status: 0 });
        }
      }
      (globalThis as any).Lampa = { Reguest: MockReguest };
      const error = await requestHttp('http://first.local/readyz', { method: 'GET', timeoutMs: 10 })
        .then(() => undefined, (rejection: unknown) => rejection);
      assert.equal(isNetworkError(error), true);
    }
  });

  it('keeps a malformed request apart from a connection failure', async () => {
    delete (globalThis as any).Lampa;
    let fetchCallCount = 0;
    globalThis.fetch = async () => {
      fetchCallCount += 1;
      throw new TypeError('Failed to fetch');
    };
    const error = await requestHttp('http://first.local/readyz', {
      headers: { 'X-Bad': 'line\nbreak' },
      method: 'GET',
    }).then(() => undefined, (rejection: unknown) => rejection);
    assert.ok(error instanceof TypeError);
    assert.equal(isNetworkError(error), false);
    assert.equal(fetchCallCount, 0);
  });

  it('does not treat server answers or other failures as network errors', () => {
    assert.equal(isNetworkError(new Error('Bearer auth failed (401): Unauthorized')), false);
    assert.equal(isNetworkError(new SyntaxError('Unexpected token in JSON')), false);
    assert.equal(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'torrents')")), false);
    assert.equal(isNetworkError('Network error (http://first.local)'), false);
    assert.equal(isNetworkError(new Error('Network error (http://first.local)')), false);
  });
});
