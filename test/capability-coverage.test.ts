/**
 * Capability coverage: natural-language user asks → guide/search/tools/instructions
 * must be sufficient for an agent to answer without inventing API shapes.
 *
 * Offline only (fixtures + DocStore). Optional live smoke lives in live-smoke.test.ts
 * and skips unless ADN_API_KEY is set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatApiKeyForTests } from '../src/api-key.js';
import { AdnClient } from '../src/client.js';
import { loadDocStore } from '../src/docs/load-node.js';
import { SERVER_INSTRUCTIONS } from '../src/instructions.js';
import { createApiTools } from '../src/tools/api-tools.js';
import { createEmbedTools } from '../src/tools/embed.js';
import { createKnowledgeTools } from '../src/tools/knowledge-tools.js';
import { selectTools } from '../src/tools/select.js';

const store = loadDocStore();
const knowledge = createKnowledgeTools(store);
const knowledgeByName = new Map(knowledge.map((t) => [t.name, t]));

function searchTitles(query: string, limit = 8): string[] {
  return store.searchDocs(query, limit).map((h) => h.title.toLowerCase());
}

function guideMentions(topic: string, patterns: RegExp[]): void {
  const content = store.getGuide(topic);
  expect(content, `missing guide ${topic}`).toBeTruthy();
  for (const pattern of patterns) {
    expect(content!, `guide ${topic} missing ${pattern}`).toMatch(pattern);
  }
}

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

/**
 * Each row is a realistic host ask. We assert the agent has:
 * - a searchable guide hit,
 * - the named tools registered when authenticated,
 * - guide/instruction content that steers toward the right capability.
 */
const USER_ASKS: Array<{
  ask: string;
  search: string;
  guideHint: RegExp;
  tools: string[];
  guideChecks?: Array<{ topic: string; patterns: RegExp[] }>;
  instructionHints?: RegExp[];
}> = [
  {
    ask: 'Upload a track to my collection',
    search: 'upload track collection create',
    guideHint: /guide: (upload|workflows)/,
    tools: [
      'adn_find_resource',
      'adn_create_track',
      'adn_create_upload_session',
      'adn_wait_for_processing',
    ],
    guideChecks: [
      {
        topic: 'workflows',
        patterns: [/adn_create_track/, /upload_url/, /adn_wait_for_processing/],
      },
    ],
    instructionHints: [/adn_create_track/, /PUT_AUDIO_BYTES|upload_url_issued/],
  },
  {
    ask: "What's in my library?",
    search: 'default collection list tracks library',
    guideHint: /guide: (upload|workflows)|default collection|list tracks/i,
    tools: ['adn_list_tracks', 'adn_find_resource', 'adn_get_organization'],
    instructionHints: [/default collection|Library/],
  },
  {
    ask: 'What plan am I on and how many AI credits do I have?',
    search: 'subscription plan AI credits billing',
    guideHint: /subscription|plan|credit|billing|guide:/i,
    tools: [
      'adn_get_subscription',
      'adn_list_plans',
      'adn_get_ai_credits',
      'adn_create_checkout',
    ],
    instructionHints: [/adn_get_subscription/, /adn_get_ai_credits/],
  },
  {
    ask: 'Switch me to the podcast output presets',
    search: 'output preset category podcasting apply',
    guideHint: /output.?preset|processing|guide:/i,
    tools: [
      'adn_apply_output_preset_category',
      'adn_list_output_presets',
      'adn_create_output_preset',
    ],
    instructionHints: [/adn_apply_output_preset_category/],
  },
  {
    ask: 'Disconnect this MCP login',
    search: 'revoke API key disconnect MCP',
    guideHint: /api.?key|revoke|guide: authentication/i,
    tools: ['adn_list_api_keys', 'adn_revoke_api_key'],
    instructionHints: [/adn_revoke_api_key/],
  },
  {
    ask: 'Put a player for that collection on my site',
    search: 'audiodn-player embed collection',
    guideHint: /guide: web-components/,
    tools: ['adn_build_player_embed', 'adn_create_client_key', 'adn_find_resource'],
    guideChecks: [
      {
        topic: 'web-components',
        patterns: [/adn_build_player_embed/, /Client-Side/, /api-key/],
      },
    ],
    instructionHints: [/adn_build_player_embed/, /Client-Side Player key/],
  },
  {
    ask: 'Play this track in my iOS / mobile app',
    search: 'play track native mobile app',
    guideHint: /guide: native-playback/,
    tools: ['adn_create_client_key', 'adn_create_play_session', 'adn_get_play_track'],
    guideChecks: [
      {
        topic: 'native-playback',
        patterns: [/play session/i, /Client-Side.*Player/i, /first_track\.variants/],
      },
    ],
    instructionHints: [/native\/mobile/, /play session/],
  },
  {
    ask: 'Give me a long-lived signed URL without a play session',
    search: 'pre-sign url without play session long-lived',
    guideHint: /guide: native-playback/,
    tools: [], // dashboard signing key — guidance only
    guideChecks: [
      {
        topic: 'native-playback',
        patterns: [/URL Signing/i, /verify/, /dashboard/i],
      },
    ],
    instructionHints: [/URL Signing key/, /timed-HMAC/],
  },
  {
    ask: 'Wait until my track is ready to play',
    search: 'wait for processing track playback ready',
    guideHint: /guide: (processing|workflows)/,
    tools: ['adn_wait_for_processing', 'adn_get_processing'],
    guideChecks: [
      {
        topic: 'processing',
        patterns: [/adn_wait_for_processing|track_playback|ready/],
      },
    ],
    instructionHints: [/adn_wait_for_processing/, /track_playback/],
  },
  {
    ask: 'Configure a webhook when processing finishes',
    search: 'webhook track status configure set',
    guideHint: /guide: webhooks/,
    tools: ['adn_get_webhooks', 'adn_set_webhooks', 'adn_test_webhook'],
    guideChecks: [
      {
        topic: 'webhooks',
        patterns: [/adn_set_webhooks/, /adn_test_webhook/, /X-ADN-Event/, /unsigned/i],
      },
    ],
    instructionHints: [/adn_set_webhooks/, /adn_test_webhook/],
  },
  {
    ask: 'How many plays did this collection get?',
    search: 'usage plays by collection',
    guideHint: /getPlays|usage\/plays|guide:/,
    tools: ['adn_get_plays', 'adn_get_usage'],
  },
  {
    ask: 'Which outputs were delivered and what was cached?',
    search: 'usage delivery cache output',
    guideHint: /getDelivery|usage\/delivery|guide:/,
    tools: ['adn_get_delivery'],
  },
  {
    ask: 'Mint a client-side player key for my app',
    search: 'client-side player api key',
    guideHint: /guide: authentication/,
    tools: ['adn_create_client_key'],
    guideChecks: [
      {
        topic: 'authentication',
        patterns: [/Client-Side/, /player/, /server-only|API Access/i],
      },
    ],
  },
  {
    ask: 'Can AudioDN normalize loudness to LUFS?',
    search: 'loudness LUFS normalization',
    guideHint: /guide: (compatibility|workflows|processing)|LUFS|loudness/,
    tools: [],
    instructionHints: [/Do not claim LUFS/],
  },
];

describe('capability coverage: user asks → guides + tools', () => {
  const client = new AdnClient({
    apiKey: formatApiKeyForTests(
      '11111111-1111-4111-8111-111111111111',
      'x'.repeat(32),
    ),
  });
  const all = selectTools(store, { client });
  const toolNames = new Set(all.map((t) => t.name));

  for (const row of USER_ASKS) {
    it(`covers: ${row.ask}`, () => {
      const titles = searchTitles(row.search);
      expect(
        titles.some((t) => row.guideHint.test(t)),
        `search("${row.search}") titles=${JSON.stringify(titles)}`,
      ).toBe(true);

      for (const tool of row.tools) {
        expect(toolNames.has(tool), `missing tool ${tool} for "${row.ask}"`).toBe(
          true,
        );
      }

      for (const check of row.guideChecks ?? []) {
        guideMentions(check.topic, check.patterns);
      }

      for (const hint of row.instructionHints ?? []) {
        expect(SERVER_INSTRUCTIONS, `instructions missing ${hint}`).toMatch(hint);
      }
    });
  }

  it('registers offline embed + knowledge tools without a client', () => {
    const offline = selectTools(store);
    const names = new Set(offline.map((t) => t.name));
    expect(names.has('adn_build_player_embed')).toBe(true);
    expect(names.has('adn_get_guide')).toBe(true);
    expect(names.has('adn_search_docs')).toBe(true);
    expect(names.has('adn_create_play_session')).toBe(false);
    expect(names.has('adn_set_webhooks')).toBe(false);
  });

  it('OpenAPI inventory includes webhook + usage operations agents need', () => {
    const ops = store.listOperations();
    const paths = new Set(ops.map((o) => `${o.method} ${o.path}`));
    for (const needed of [
      'GET /v1/organization/{organization_id}/webhooks',
      'PUT /v1/organization/{organization_id}/webhooks',
      'POST /v1/organization/{organization_id}/webhooks/test',
      'GET /v1/usage',
      'GET /v1/usage/plays',
      'GET /v1/usage/delivery',
      'POST /v1/play_session/{scope}',
      'POST /v1/api_key',
    ]) {
      expect(paths.has(needed), `missing OpenAPI path ${needed}`).toBe(true);
    }
  });
});

describe('capability coverage: mocked happy paths', () => {
  it('embed ask → paste-ready player HTML without a live API call', () => {
    const embed = createEmbedTools()[0];
    const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const apiKey = formatApiKeyForTests(orgId, 'p'.repeat(32));
    const result: any = embed.handler({
      scope: 'collection',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      api_key: apiKey,
      variants: ['hq', 'lq'],
    });
    expect(result.html).toMatch(/<audiodn-player/);
    expect(result.html).toMatch(/api-key=/);
    expect(result.html).toMatch(/variants="hq,lq"/);
    expect(result.html).not.toMatch(/Authorization|Bearer/);
    expect(result.notes.join(' ')).toMatch(/Client-Side|API Access/i);
  });

  it('native play ask → play session returns signed variant URLs', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      jsonResponse({
        ok: true,
        play_session_id: 'ps1',
        first_track: {
          variants: [
            { index: 'hq', url: 'https://cdn.example/t_hq.mp3?verify=1-abc' },
            { index: 'lq', url: 'https://cdn.example/t_lq.mp3?verify=1-def' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { byName } = (() => {
      const client = new AdnClient({ apiKey: 'adn_test' });
      return { byName: new Map(createApiTools(client).map((t) => [t.name, t])) };
    })();

    const result: any = await byName.get('adn_create_play_session')!.handler({
      scope: 'track',
      track_id: '00000000-0000-4000-8000-000000000099',
      variants: ['hq', 'lq'],
    });
    expect(result.first_track.variants[0].url).toMatch(/verify=/);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/play_session\/track$/);
  });

  it('webhook ask → set URL then test delivery', async () => {
    const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const apiKey = formatApiKeyForTests(orgId, 'w'.repeat(32));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/webhooks/test')) {
        return jsonResponse({
          ok: true,
          delivered: true,
          status: '200',
          response_snippet: 'ok',
          event: 'track.status_changed',
          channel: 'track',
          target: 'https://hooks.example.com/adn',
        });
      }
      return jsonResponse({
        ok: true,
        organization_id: orgId,
        webhooks: {
          webhook_url: 'https://hooks.example.com/adn',
          webhook_url_collection: null,
          webhook_url_file: null,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdnClient({ apiKey });
    const byName = new Map(createApiTools(client).map((t) => [t.name, t]));

    const setResult: any = await byName.get('adn_set_webhooks')!.handler({
      webhook_url: 'https://hooks.example.com/adn',
    });
    expect(setResult.webhooks.webhook_url).toBe('https://hooks.example.com/adn');

    const testResult: any = await byName.get('adn_test_webhook')!.handler({
      channel: 'track',
    });
    expect(testResult.delivered).toBe(true);
    expect(testResult.event).toBe('track.status_changed');
  });

  it('usage ask → plays + delivery tools hit the right paths', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      jsonResponse({ ok: true, summary: {}, series: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdnClient({ apiKey: 'adn_test' });
    const byName = new Map(createApiTools(client).map((t) => [t.name, t]));

    await byName.get('adn_get_plays')!.handler({ group_by: 'collection' });
    await byName.get('adn_get_delivery')!.handler({ group_by: 'output' });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('/v1/usage/plays'))).toBe(true);
    expect(urls.some((u) => u.includes('/v1/usage/delivery'))).toBe(true);
  });

  it('knowledge ask → adn_search_docs + adn_get_guide return actionable content', () => {
    const search: any = knowledgeByName.get('adn_search_docs')!.handler({
      query: 'configure webhook for track ready',
      limit: 5,
    });
    expect(search.results.length).toBeGreaterThan(0);
    expect(
      search.results.some((r: any) => /webhook/i.test(r.title) || /webhook/i.test(r.snippet)),
    ).toBe(true);

    const guide: any = knowledgeByName.get('adn_get_guide')!.handler({
      topic: 'webhooks',
    });
    expect(guide.content).toMatch(/adn_set_webhooks/);
  });
});
