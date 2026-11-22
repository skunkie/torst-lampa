// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

interface HttpRequestOptions {
  body?: string | FormData | Blob,
  headers?: Record<string, string>,
  method?: string,
  needsResponseHeaders?: boolean,
  responseType?: 'blob',
  shouldUseNativeBinaryResponse?: boolean,
  signal?: AbortSignal,
  timeoutMs?: number
}

interface HttpResponse {
  blob: () => Promise<Blob>,
  headers?: Headers,
  json: () => Promise<unknown>,
  ok: boolean,
  status: number,
  statusText?: string,
  text: () => Promise<string>
}

interface LampaAjaxParams {
  bodyEncoding?: 'base64',
  contentType?: string,
  crossDomain: boolean,
  dataType: string,
  headers: Record<string, string>,
  returnHeaders?: boolean,
  timeout: number,
  type: string
}

interface LampaFailureResponse {
  message?: string,
  responseText?: string,
  status?: number,
  statusText?: string
}

/**
 * A request that failed before the server answered at all (connection failure or timeout).
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Reports whether a request failed before the server answered at all (connection failure,
 * timeout, or abort), as opposed to the server answering with an error.
 */
export function isNetworkError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NetworkError' || error.name === 'AbortError');
}

function createAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

class LampaRequestInvocationError extends Error {}

type LampaRequestFn = (
  requestUrl: string,
  onSuccess: (responseBody: string | object) => void,
  onFailure: (lampaResponse: LampaFailureResponse) => void,
  requestPostData: string | false,
  requestParams: LampaAjaxParams
) => void;

const ADDITIONAL_NATIVE_METHODS: readonly string[] = ['DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'PUT'];

async function encodeBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function binaryResponse(body: string | object): HttpResponse {
  const response = (typeof body === 'string' ? JSON.parse(body) : body) as { body?: string, encoding?: string, headers?: Record<string, string> };
  if (response.encoding !== 'base64' || typeof response.body !== 'string') throw new Error('Android returned an invalid binary response');
  const decoded = atob(response.body);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  const headers = new Headers(response.headers);
  const blob = new Blob([bytes], { type: headers.get('Content-Type') || '' });
  return {
    blob: async () => blob,
    headers,
    json: async () => JSON.parse(await blob.text()),
    ok: true,
    status: 200,
    text: async () => blob.text(),
  };
}

export async function requestHttp(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse> {
  if (options.signal?.aborted) throw createAbortError();

  const method = options.method || 'GET';
  const headers = options.headers || {};
  const timeoutMs = options.timeoutMs || 15000;
  const isConditionalRead = (method === 'GET' || method === 'HEAD') && Object.keys(headers).some(name => name.toLowerCase() === 'if-none-match');
  const hasBinaryBody = options.body instanceof Blob;
  const usesBinaryTransport = (hasBinaryBody || (options.responseType === 'blob' && options.shouldUseNativeBinaryResponse)) && typeof Lampa !== 'undefined' && !!Lampa.Platform?.is('android');

  // Prefer `Lampa.Reguest` when running in Lampa environment
  if (typeof Lampa !== 'undefined' && Lampa.Reguest && !options.needsResponseHeaders && (!options.responseType || usesBinaryTransport) && !(options.body instanceof FormData) && (!hasBinaryBody || usesBinaryTransport)) {
    const lampaRequest = new Lampa.Reguest();
    lampaRequest.timeout(timeoutMs);
    if (usesBinaryTransport && typeof lampaRequest.native !== 'function') throw new Error('Android native HTTP transport is unavailable');

    const buildAjaxParams = (): LampaAjaxParams => {
      const params: LampaAjaxParams = {
        crossDomain: true,
        dataType: options.responseType === 'blob' ? 'base64' : 'text',
        headers: { ...headers },
        timeout: timeoutMs,
        type: method,
      };
      if (hasBinaryBody) params.bodyEncoding = 'base64';
      if (options.responseType === 'blob') params.returnHeaders = true;
      const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || (options.body instanceof Blob ? options.body.type : '');
      if (contentType) {
        params.contentType = contentType;
        if (hasBinaryBody && !Object.keys(params.headers).some(name => name.toLowerCase() === 'content-type')) params.headers['Content-Type'] = contentType;
      }
      return params;
    };

    const dispatch = (
      invoke: LampaRequestFn,
      ajaxParams: LampaAjaxParams,
      postData: string | false
    ): Promise<HttpResponse> => new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(createAbortError());
        return;
      }

      let isSettled = false;

      const handleAbort = () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);
        if (typeof lampaRequest.clear === 'function') lampaRequest.clear();
        reject(createAbortError());
      };

      const cleanup = () => {
        options.signal?.removeEventListener('abort', handleAbort);
      };

      // A hung native bridge call (no success or error callback ever fires)
      // must still resolve this promise within the caller's own deadline.
      const timeoutHandle = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        reject(new NetworkError(`Network error (${url}): request timed out`));
      }, timeoutMs);

      options.signal?.addEventListener('abort', handleAbort, { once: true });

      const settleResolve = (response: HttpResponse) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);
        cleanup();
        resolve(response);
      };

      const settleReject = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);
        cleanup();
        reject(err);
      };

      try {
        invoke(
          url,
          (responseBody: string | object) => {
            if (ajaxParams.dataType === 'base64') {
              try { settleResolve(binaryResponse(responseBody)); }
              catch (error) { settleReject(error instanceof Error ? error : new Error('Invalid binary response')); }
              return;
            }
            // Lampa's `Reguest` wrapper only passes the parsed body to its success callback
            // without exposing the underlying jqXHR status. We synthesize 200 vs 204 based
            // on whether the response body contains data, and 304 for an empty answer to a
            // conditional read, which ajax counts as a success.
            const hasBody = responseBody !== null && responseBody !== undefined && responseBody !== '';
            const responseText = typeof responseBody === 'string'
              ? responseBody
              : (responseBody ? JSON.stringify(responseBody) : '');
            const isNotModified = !hasBody && isConditionalRead;
            const status = hasBody ? 200 : (isNotModified ? 304 : 204);
            const statusText = hasBody ? 'OK' : (isNotModified ? 'Not Modified' : 'No Content');

            settleResolve({
              blob: async () => new Blob([responseText]),
              json: async () => (
                responseBody && typeof responseBody === 'object'
                  ? responseBody
                  : (responseText ? JSON.parse(responseText) : {})
              ),
              ok: !isNotModified,
              status,
              statusText,
              text: async () => responseText,
            });
          },
          (lampaResponse: LampaFailureResponse) => {
            const status = lampaResponse?.status || 0;
            const statusText = lampaResponse?.statusText || lampaResponse?.message || '';
            const responseText = lampaResponse?.responseText || lampaResponse?.message || '';
            if (status >= 200 && status < 300) {
              settleResolve({
                blob: async () => new Blob([responseText]),
                json: async () => (responseText ? JSON.parse(responseText) : {}),
                ok: true,
                status,
                statusText,
                text: async () => responseText,
              });
            } else if (status > 0) {
              settleResolve({
                blob: async () => new Blob([responseText]),
                json: async () => (responseText ? JSON.parse(responseText) : {}),
                ok: false,
                status,
                statusText,
                text: async () => responseText,
              });
            } else {
              settleReject(new NetworkError(`Network error (${url})`));
            }
          },
          postData,
          ajaxParams
        );
      } catch (error) {
        settleReject(new LampaRequestInvocationError(
          error instanceof Error ? error.message : String(error)
        ));
      }
    });

    let realPostData: string | false = typeof options.body === 'string' ? options.body : false;
    const canUseNativeBridge = method === 'GET' || method === 'POST'
      || (ADDITIONAL_NATIVE_METHODS.includes(method) && !!Lampa.Platform?.is('android'));

    if (typeof lampaRequest.native === 'function' && canUseNativeBridge) {
      if (options.body instanceof Blob) realPostData = await encodeBlob(options.body);
      try {
        return await dispatch(lampaRequest.native.bind(lampaRequest), buildAjaxParams(), realPostData);
      } catch (err) {
        const isReadOnlyMethod = method === 'GET';
        if (usesBinaryTransport) throw err;
        // A caller that aborted mid-flight wants the request gone, not re-issued on the
        // fallback transport: re-dispatching would ignore the already-aborted signal and
        // deliver a response for a request nobody is waiting for any more.
        if (
          options.signal?.aborted
          || typeof lampaRequest.silent !== 'function'
          || (!(err instanceof LampaRequestInvocationError) && !isReadOnlyMethod)
        ) throw err;
        return await dispatch(lampaRequest.silent.bind(lampaRequest), buildAjaxParams(), realPostData);
      }
    }

    if (usesBinaryTransport) return requestFetch(url, options);
    if (typeof lampaRequest.silent === 'function') {
      return dispatch(lampaRequest.silent.bind(lampaRequest), buildAjaxParams(), realPostData);
    }
  }

  return requestFetch(url, options);
}

async function requestFetch(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  if (options.signal?.aborted) throw createAbortError();
  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs || 15000;
  // Fallback to fetch (Node.js test environment or when `Lampa.Reguest` is unavailable)
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const handleAbort = () => controller?.abort();
  options.signal?.addEventListener('abort', handleAbort, { once: true });
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const requestInit: RequestInit = {
      body: options.body,
      headers: options.headers,
      method,
      signal: controller?.signal || options.signal,
    };
    // fetch() reports both a malformed request (bad URL or header) and a connection failure as
    // a bare TypeError. Building the Request up front surfaces the malformed case on its own,
    // so a TypeError from fetch() itself can only mean the server was never reached.
    if (typeof Request === 'function') new Request(url, requestInit);
    const response = await fetch(url, requestInit).catch((error: unknown) => {
      if (error instanceof TypeError) throw new NetworkError(error.message);
      throw error;
    });
    const responseBlob = options.responseType === 'blob' ? await response.blob() : undefined;
    const responseText = responseBlob ? '' : await response.text();
    return {
      blob: async () => responseBlob || new Blob([responseText]),
      headers: response.headers,
      json: async () => {
        const text = responseBlob ? await responseBlob.text() : responseText;
        return text ? JSON.parse(text) : {};
      },
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: async () => responseBlob ? responseBlob.text() : responseText,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    options.signal?.removeEventListener('abort', handleAbort);
  }
}
