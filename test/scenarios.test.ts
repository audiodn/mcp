/**
 * Scenario suite for the MCP reliability upgrade (plan section G).
 * Fixture/mocked — no live customer data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdnClient } from '../src/client.js';
import { createApiTools } from '../src/tools/api-tools.js';
import { findResource } from '../src/tools/find.js';
import { waitForProcessing } from '../src/tools/wait.js';
import { runToolHandler, toolTextResult } from '../src/tools/run.js';
import type { ToolDef } from '../src/tools/types.js';
import { z } from 'zod';
import type { AdnClient as AdnClientType } from '../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toolsByName(apiKey = 'adn_test_secret_key') {
  const client = new AdnClient({ apiKey });
  const tools = createApiTools(client);
  return {
    client,
    byName: new Map(tools.map((t) => [t.name, t])),
  };
}

function mockClient(overrides: Partial<AdnClientType> = {}): AdnClientType {
  return {
    getTrackProcessing: vi.fn(),
    getTrackCoverStatus: vi.fn(),
    getCollectionCoverStatus: vi.fn(),
    listCollections: vi.fn(),
    listCreators: vi.fn(),
    listTracks: vi.fn(),
    createCollection: vi.fn(),
    createTrack: vi.fn(),
    deleteCollection: vi.fn(),
    deleteTrack: vi.fn(),
    deleteCreator: vi.fn(),
    ...overrides,
  } as unknown as AdnClientType;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scenario: create stages and idempotency', () => {
  it('create track returns upload_url_issued and does not claim bytes uploaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        track_id: 't1',
        stage: 'upload_url_issued',
        track_upload: { upload_url: 'https://upload.example/signed', method: 'PUT' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();
    const result: any = await byName.get('adn_create_track')!.handler({
      collection_id: '00000000-0000-4000-8000-000000000001',
      file_name: 'ep.mp3',
    });
    expect(result.stage).toBe('upload_url_issued');
    expect(result.message).toMatch(/PUT audio bytes/i);
    expect(result.message).not.toMatch(/uploaded successfully/i);
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('sends Idempotency-Key only when the tool argument is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, collection_id: 'c1' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();
    await byName.get('adn_create_collection')!.handler({
      title: 'Live',
      idempotency_key: 'retry-1',
    });
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('retry-1');
  });
});

describe('scenario: dry_run deletes', () => {
  it('dry_run collection delete previews and never calls DELETE', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/track')) {
        return jsonResponse({ ok: true, count: 2, tracks: [{ id: 't1' }, { id: 't2' }] });
      }
      return jsonResponse({
        ok: true,
        collection: { id: '00000000-0000-4000-8000-000000000010', title: 'Live' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();
    const result: any = await byName.get('adn_delete_collection')!.handler({
      collection_id: '00000000-0000-4000-8000-000000000010',
      dry_run: true,
    });
    expect(result.dry_run).toBe(true);
    expect(result.track_count).toBe(2);
    expect(fetchMock.mock.calls.every((c) => c[1]?.method !== 'DELETE')).toBe(true);
  });

  it('dry_run track delete does not call DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, track: { id: '00000000-0000-4000-8000-000000000011' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();
    const result: any = await byName.get('adn_delete_track')!.handler({
      track_id: '00000000-0000-4000-8000-000000000011',
      dry_run: true,
    });
    expect(result.dry_run).toBe(true);
    expect(fetchMock.mock.calls.every((c) => c[1]?.method !== 'DELETE')).toBe(true);
  });
});

describe('scenario: find never creates', () => {
  it('zero matches returns needs_input without calling create', async () => {
    const createCollection = vi.fn();
    const client = mockClient({
      listCollections: vi.fn().mockResolvedValue({ exact: [], partial: [], has_more: false }),
      createCollection,
    });
    const result = await findResource(client, { type: 'collection', name: 'Missing' });
    expect(result.status).toBe('needs_input');
    expect(result.code).toBe('COLLECTION_NOT_FOUND');
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('partial-only matches stay suggestions and never auto-pick', async () => {
    const client = mockClient({
      listCollections: vi.fn().mockResolvedValue({
        exact: [],
        partial: [{ id: 'c1', title: 'Live Sessions' }],
      }),
    });
    const result = await findResource(client, { type: 'collection', name: 'Live' });
    expect(result.status).toBe('needs_input');
    expect(result.candidates?.length).toBe(1);
    expect(result.resource_ids).toBeUndefined();
  });
});

describe('scenario: wait outcomes', () => {
  it('settled with a failed output is partial_success', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'ready',
        files_completed_at: '2026-01-01T00:00:00Z',
        playable: true,
        outputs: [
          { index: 'hq', state: 'ready', is_required: true },
          { index: 'wave', state: 'failed', is_required: false, status_text: 'boom' },
        ],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_settled',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('partial_success');
    expect(result.code).toBe('SETTLED_WITH_FAILURES');
  });

  it('playback can succeed while optional waveform is still pending', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'ready',
        playable: true,
        outputs: [
          { index: 'hq', output_type_id: 'transcode', state: 'ready', is_required: true },
          { index: 'wave', output_type_id: 'waveform_image', state: 'pending', is_required: false },
        ],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_playback',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('success');
    expect((result as any).optional_outputs).toHaveLength(1);
  });

  it('failed output is terminal and does not keep polling', async () => {
    const getTrackProcessing = vi.fn().mockResolvedValue({
      track_id: 't1',
      track_status_id: 'processing',
      playable: false,
      outputs: [{ index: 'hq', state: 'failed', status_text: 'encode failed' }],
    });
    const client = mockClient({ getTrackProcessing });
    const result = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'hq',
      timeout_seconds: 5,
    });
    expect(result.status).toBe('terminal_error');
    expect(result.code).toBe('OUTPUT_FAILED');
    expect(getTrackProcessing).toHaveBeenCalledTimes(1);
  });

  it('cover ready returns theme colours for the requested image', async () => {
    const client = mockClient({
      getTrackCoverStatus: vi.fn().mockResolvedValue({
        cover: {
          state: 'ready',
          theme: [{ hex: '#abc', active: true }],
          player_color: '#abc',
          cloudflare_image_id: 'img-b',
        },
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'cover',
      track_id: 't1',
      cloudflare_image_id: 'img-b',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('success');
    expect(result.code).toBe('COVER_READY');
    expect((result as any).player_color).toBe('#abc');
  });
});

describe('scenario: structured errors and metadata safety', () => {
  it('maps API 409 to IDEMPOTENCY_CONFLICT', async () => {
    const tool: ToolDef = {
      name: 'adn_demo',
      description: 'demo',
      inputSchema: z.object({}),
      handler: async () => {
        const err: any = new Error('Idempotency key reused with different body');
        err.status = 409;
        err.apiRequestId = 'req-409';
        throw err;
      },
    };
    const result = await runToolHandler(tool, {});
    expect(result.structuredContent?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(result.structuredContent?.api_request_id).toBe('req-409');
  });

  it('returns malicious metadata as data, not executed', () => {
    const payload = {
      status: 'success',
      metadata: {
        title: '<script>alert(1)</script>',
        note: '"); DROP TABLE track;--',
      },
    };
    const result = toolTextResult(payload);
    const text = result.content[0].text;
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).toContain('DROP TABLE');
    expect(result.structuredContent?.metadata).toEqual(payload.metadata);
  });

  it('redacts the API key from client error messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          message: 'forbidden for adn_test_secret_key at https://upload.example/signed?tok=abc',
        },
        403,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdnClient({ apiKey: 'adn_test_secret_key' });
    try {
      await client.getTrack('t1');
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err.message).not.toContain('adn_test_secret_key');
      expect(err.message).toContain('[REDACTED_API_KEY]');
    }
  });
});
