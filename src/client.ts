/**
 * Thin REST client over the AudioDN HTTP API. Used by the MCP tool handlers.
 * The MCP server passes ADN_API_KEY (server-side, full-access) via env.
 *
 * Hardening: per-request timeout via AbortController, a small bounded retry on
 * transient failures (network errors, 429, 5xx), and structured ApiError that
 * never echoes the API key.
 */

const DEFAULT_BASE_URL = 'https://api.audiodelivery.net';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface ApiError extends Error {
  status: number;
  apiRequestId?: string;
}

export class AdnClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) {
      throw new Error('AdnClient requires an apiKey (set ADN_API_KEY).');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const idempotent = method === 'GET';

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
        });

        const text = await res.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = { ok: false, message: text || 'Non-JSON response' };
        }

        if (!res.ok || (parsed && parsed.ok === false)) {
          // Retry transient server-side / rate-limit failures on safe methods.
          if (shouldRetry(res.status) && idempotent && attempt < MAX_RETRIES) {
            lastErr = makeError(parsed, method, path, res.status);
            await backoff(attempt);
            continue;
          }
          throw makeError(parsed, method, path, res.status);
        }

        return parsed as T;
      } catch (err) {
        lastErr = err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const isNetwork = err instanceof TypeError; // fetch network failure
        if ((isAbort || isNetwork) && idempotent && attempt < MAX_RETRIES) {
          await backoff(attempt);
          continue;
        }
        // Normalize timeouts into an ApiError with a stable message.
        if (isAbort) {
          const e = new Error(
            `AudioDN ${method} ${path} timed out after ${this.timeoutMs}ms`,
          ) as ApiError;
          e.status = 0;
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // --- Organizations ---
  getOrganization(organizationId: string) {
    return this.request('GET', `/v1/organization/${organizationId}`);
  }

  // --- Creators ---
  listCreators(params?: { limit?: number; offset?: number }) {
    return this.request('GET', `/v1/creator${listQuery(params)}`);
  }

  getCreator(creatorId: string) {
    return this.request('GET', `/v1/creator/${creatorId}`);
  }

  createCreator(body: {
    organization_index: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request('POST', `/v1/creator`, body);
  }

  updateCreator(creatorId: string, body: Record<string, unknown>) {
    return this.request('PUT', `/v1/creator/${creatorId}`, body);
  }

  deleteCreator(creatorId: string) {
    return this.request('DELETE', `/v1/creator/${creatorId}`);
  }

  // --- Collections ---
  listCollections(params?: { limit?: number; offset?: number }) {
    return this.request('GET', `/v1/collection${listQuery(params)}`);
  }

  getCollection(collectionId: string) {
    return this.request('GET', `/v1/collection/${collectionId}`);
  }

  createCollection(body: {
    title: string;
    creator_id?: string;
    organization_index?: string;
    metadata?: Record<string, unknown>;
    player_color?: string;
    player_subtitle?: string;
  }) {
    return this.request('POST', `/v1/collection`, body);
  }

  updateCollection(collectionId: string, body: Record<string, unknown>) {
    return this.request('PUT', `/v1/collection/${collectionId}`, body);
  }

  deleteCollection(collectionId: string) {
    return this.request('DELETE', `/v1/collection/${collectionId}`);
  }

  // --- Tracks ---
  listTracks(
    collectionId: string,
    params?: { limit?: number; offset?: number },
  ) {
    return this.request(
      'GET',
      `/v1/collection/${collectionId}/track${listQuery(params)}`,
    );
  }

  getTrack(trackId: string) {
    return this.request('GET', `/v1/track/${trackId}`);
  }

  createTrack(body: {
    collection_id: string;
    file_name: string;
    creator_id?: string;
    organization_index?: string;
    metadata?: Record<string, unknown>;
    player_title?: string;
    player_subtitle?: string;
    player_color?: string;
  }) {
    return this.request('POST', `/v1/track`, body);
  }

  deleteTrack(trackId: string) {
    return this.request('DELETE', `/v1/track/${trackId}`);
  }

  // --- Upload sessions ---
  createUploadSession(body: {
    collection_id: string;
    creator_id?: string;
    organization_index?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request('POST', `/v1/upload_session`, body);
  }

  getUploadSession(uploadSessionId: string) {
    return this.request('GET', `/v1/upload_session/${uploadSessionId}`);
  }

  createTrackInUploadSession(
    uploadSessionId: string,
    body: {
      file_name: string;
      organization_index?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.request('POST', `/v1/upload/${uploadSessionId}/track`, body);
  }

  // --- Play sessions ---
  createPlaySession(
    scope: 'collection' | 'track',
    body: {
      variants?: string[];
      collection_id?: string;
      track_id?: string;
    },
  ) {
    return this.request('POST', `/v1/play_session/${scope}`, body);
  }

  getPlaySession(playSessionId: string) {
    return this.request('GET', `/v1/play_session/${playSessionId}`);
  }

  // --- Variants ---
  listVariants(params?: { limit?: number; offset?: number }) {
    return this.request('GET', `/v1/variant${listQuery(params)}`);
  }
}

function listQuery(params?: { limit?: number; offset?: number }): string {
  const q = new URLSearchParams();
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const s = q.toString();
  return s ? `?${s}` : '';
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoff(attempt: number): Promise<void> {
  const ms = 250 * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeError(
  parsed: any,
  method: string,
  path: string,
  status: number,
): ApiError {
  const err = new Error(
    parsed?.message || `AudioDN ${method} ${path} failed with HTTP ${status}`,
  ) as ApiError;
  err.status = status;
  err.apiRequestId = parsed?.api_request_id;
  return err;
}
