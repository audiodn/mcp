import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdnClient } from '../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AdnClient', () => {
  it('sends Bearer auth and builds list query strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, creators: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await client.listCreators({ limit: 10, offset: 5 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.audiodelivery.net/v1/creator?limit=10&offset=5');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer adn_secret');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sends JSON body + content-type on POST to the correct path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, upload_session_id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await client.createUploadSession({ collection_id: 'c1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.audiodelivery.net/v1/upload_session');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ collection_id: 'c1' });
  });

  it('parses API errors including api_request_id and status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: false, message: 'Not found', api_request_id: 'req-123' }, 404),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await expect(client.getTrack('t1')).rejects.toMatchObject({
      message: 'Not found',
      status: 404,
      apiRequestId: 'req-123',
    });
  });

  it('never leaks the API key in error messages', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ ok: false, message: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_super_secret_key' });
    try {
      await client.getTrack('t1');
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(500);
      expect(err.message).not.toContain('adn_super_secret_key');
    }
  });

  it('retries transient 5xx on GET and eventually throws', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ ok: false, message: 'boom' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await expect(client.listCollections()).rejects.toMatchObject({ status: 503 });
    // 1 initial + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 4xx client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, message: 'bad' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await expect(client.listCollections()).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry mutating (POST) requests on 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, message: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret' });
    await expect(client.createCollection({ title: 'x' })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes aborts/timeouts into a timeout error', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const client = new AdnClient({ apiKey: 'adn_secret', timeoutMs: 10 });
    await expect(client.getTrack('t1')).rejects.toMatchObject({ status: 0 });
    // GET is retried before giving up
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
