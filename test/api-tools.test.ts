import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatApiKeyForTests } from '../src/api-key.js';
import { AdnClient } from '../src/client.js';
import { createApiTools } from '../src/tools/api-tools.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toolsByName(apiKey = 'adn_test') {
  const client = new AdnClient({ apiKey });
  const tools = createApiTools(client);
  return {
    client,
    byName: new Map(tools.map((t) => [t.name, t])),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api tool handlers (mocked fetch)', () => {
  it('creates an upload session with expires_in and nested track', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, upload_session_id: 'u1', track_id: 't1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { byName } = toolsByName();
    await byName.get('adn_create_upload_session')!.handler({
      collection_id: '00000000-0000-4000-8000-000000000001',
      expires_in: 7200,
      track: { file_name: 'ep1.mp3', player_title: 'Ep 1' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      collection_id: '00000000-0000-4000-8000-000000000001',
      expires_in: 7200,
      track: { file_name: 'ep1.mp3', player_title: 'Ep 1' },
    });
  });

  it('passes player fields on create track in upload session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { byName } = toolsByName();
    await byName.get('adn_create_track_in_upload_session')!.handler({
      upload_session_id: '00000000-0000-4000-8000-000000000002',
      file_name: 'a.mp3',
      player_title: 'A',
      player_color: '#aabbcc',
      is_cover_overridable: true,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      file_name: 'a.mp3',
      player_title: 'A',
      player_color: '#aabbcc',
      is_cover_overridable: true,
    });
  });

  it('rejects play-session scope/id mismatches without calling fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();

    expect(() =>
      byName.get('adn_create_play_session')!.handler({
        scope: 'collection',
        track_id: '00000000-0000-4000-8000-000000000003',
        variants: ['hq'],
      }),
    ).toThrow(/track_id/);

    expect(() =>
      byName.get('adn_create_play_session')!.handler({
        scope: 'track',
        collection_id: '00000000-0000-4000-8000-000000000004',
        variants: ['hq'],
      }),
    ).toThrow(/collection_id/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty update bodies without calling fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();

    expect(() =>
      byName.get('adn_update_track')!.handler({
        track_id: '00000000-0000-4000-8000-000000000005',
      }),
    ).toThrow(/at least one field/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives organization_id from the API key prefix', async () => {
    const orgId = '11111111-1111-4111-8111-111111111111';
    const apiKey = formatApiKeyForTests(orgId, 'x'.repeat(32));

    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ ok: true, organization_id: orgId }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { byName } = toolsByName(apiKey);
    await byName.get('adn_get_organization')!.handler({});

    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.audiodelivery.net/v1/organization/${orgId}`,
    );
  });

  it('calls cover, variant, download, and client-key endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();

    await byName.get('adn_create_collection_cover')!.handler({
      collection_id: '00000000-0000-4000-8000-000000000010',
    });
    await byName.get('adn_create_track_cover')!.handler({
      track_id: '00000000-0000-4000-8000-000000000011',
    });
    await byName.get('adn_get_variant')!.handler({
      variant_id: '00000000-0000-4000-8000-000000000012',
    });
    await byName.get('adn_get_play_download')!.handler({
      play_session_id: '00000000-0000-4000-8000-000000000013',
      play_track_id: '00000000-0000-4000-8000-000000000014',
      variant_index: 'hq',
    });
    await byName.get('adn_create_client_key')!.handler({
      title: 'Player',
      api_key_type_id: 'player',
      collection_id: '00000000-0000-4000-8000-000000000015',
    });

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain(
      'https://api.audiodelivery.net/v1/collection/00000000-0000-4000-8000-000000000010/cover',
    );
    expect(urls).toContain(
      'https://api.audiodelivery.net/v1/track/00000000-0000-4000-8000-000000000011/cover',
    );
    expect(urls).toContain(
      'https://api.audiodelivery.net/v1/output_preset/00000000-0000-4000-8000-000000000012',
    );
    expect(urls).toContain(
      'https://api.audiodelivery.net/v1/play/00000000-0000-4000-8000-000000000013/00000000-0000-4000-8000-000000000014/hq/download',
    );
    expect(urls).toContain('https://api.audiodelivery.net/v1/api_key');
  });

  it('canonical and legacy output-preset tool names hit the same client paths', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();

    await byName.get('adn_list_output_presets')!.handler({ limit: 10 });
    await byName.get('adn_list_variants')!.handler({ limit: 10 });
    await byName.get('adn_get_output_preset')!.handler({
      output_preset_id: '00000000-0000-4000-8000-000000000020',
    });
    await byName.get('adn_get_variant')!.handler({
      variant_id: '00000000-0000-4000-8000-000000000020',
    });
    await byName.get('adn_create_track_output')!.handler({
      track_id: '00000000-0000-4000-8000-000000000021',
      output_type_id: 'transcode',
      index: 'voice',
    });
    await byName.get('adn_create_track_variant')!.handler({
      track_id: '00000000-0000-4000-8000-000000000021',
      variant_type_id: 'transcode',
      index: 'voice2',
    });

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes('/v1/output_preset')).length).toBe(4);
    expect(urls).toContain(
      'https://api.audiodelivery.net/v1/track/00000000-0000-4000-8000-000000000021/output',
    );
    expect(urls.every((u) => !u.includes('/v1/variant'))).toBe(true);
  });

  it('reads the uncached processing snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        track_id: '00000000-0000-4000-8000-000000000030',
        track_status_id: 'processing',
        upload_accepted: true,
        playable: false,
        outputs: [{ index: 'hq', state: 'pending' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();
    const result: any = await byName.get('adn_get_processing')!.handler({
      track_id: '00000000-0000-4000-8000-000000000030',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.audiodelivery.net/v1/track/00000000-0000-4000-8000-000000000030/processing',
    );
    expect(result.track_status_id).toBe('processing');
    expect(result.outputs[0].state).toBe('pending');
  });

  it('validates share keys require exactly one variant', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName();

    expect(() =>
      byName.get('adn_create_client_key')!.handler({
        title: 'Share',
        api_key_type_id: 'share',
        variants: ['hq', 'lq'],
      }),
    ).toThrow(/exactly one variant/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives org id for webhook tools and rejects empty set bodies', async () => {
    const orgId = '22222222-2222-4222-8222-222222222222';
    const apiKey = formatApiKeyForTests(orgId, 'y'.repeat(32));
    const fetchMock = vi.fn().mockImplementation(() =>
      jsonResponse({
        ok: true,
        organization_id: orgId,
        webhooks: { webhook_url: null, webhook_url_collection: null, webhook_url_file: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName(apiKey);

    await byName.get('adn_get_webhooks')!.handler({});
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.audiodelivery.net/v1/organization/${orgId}/webhooks`,
    );

    expect(() => byName.get('adn_set_webhooks')!.handler({})).toThrow(
      /at least one field/,
    );

    await byName.get('adn_set_webhooks')!.handler({
      webhook_url: '',
      webhook_url_file: 'https://hooks.example.com/file',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      webhook_url: '',
      webhook_url_file: 'https://hooks.example.com/file',
    });
  });

  it('rejects non-https webhook URLs at the schema layer', () => {
    const { byName } = toolsByName();
    const parsed = byName.get('adn_set_webhooks')!.inputSchema.safeParse({
      webhook_url: 'http://hooks.example.com/track',
    });
    expect(parsed.success).toBe(false);
  });

  it('passes through test-webhook delivery results', async () => {
    const orgId = '33333333-3333-4333-8333-333333333333';
    const apiKey = formatApiKeyForTests(orgId, 'z'.repeat(32));
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        delivered: true,
        status: '200',
        response_snippet: 'ok',
        event: 'track.status_changed',
        channel: 'track',
        target: 'https://hooks.example.com/track',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = toolsByName(apiKey);

    const result: any = await byName.get('adn_test_webhook')!.handler({
      channel: 'track',
      url: 'https://hooks.example.com/track',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.audiodelivery.net/v1/organization/${orgId}/webhooks/test`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      channel: 'track',
      url: 'https://hooks.example.com/track',
    });
    expect(result.delivered).toBe(true);
    expect(result.status).toBe('200');
  });
});
