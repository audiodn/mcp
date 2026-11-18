import { describe, expect, it } from 'vitest';
import { GUIDE_TOPICS } from '../src/docs/store.js';
import { loadDocStore } from '../src/docs/load-node.js';
import { createKnowledgeTools } from '../src/tools/knowledge-tools.js';

const store = loadDocStore();
const tools = createKnowledgeTools(store);
const byName = new Map(tools.map((t) => [t.name, t]));

describe('DocStore (offline)', () => {
  it('reports version and bundled openapi version', () => {
    const about = store.about();
    expect(about.openapiVersion).toBe('1.5.0');
    expect(about.docsSource).toBe('bundled snapshot');
    expect(about.apiBase).toContain('api.audiodelivery.net');
  });

  it('lists all canonical operations with operationIds', () => {
    const ops = store.listOperations();
    expect(ops.length).toBe(63);
    expect(ops.every((o) => o.operationId && o.method && o.path)).toBe(true);
    expect(ops.some((o) => o.path === '/v1/stream/{track_id}/{api_key}')).toBe(true);
    expect(ops.some((o) => o.path === '/v1/output_preset')).toBe(true);
    expect(ops.some((o) => o.path === '/v1/track/{track_id}/output')).toBe(true);
  });

  it('resolves a known operationId', () => {
    const op = store.getOperation('createUploadSession');
    expect(op).toBeTruthy();
    expect(op?.method).toBe('POST');
    expect(op?.path).toBe('/v1/upload_session');
  });

  it('returns null for unknown operationId', () => {
    expect(store.getOperation('nope')).toBeNull();
  });

  it('provides a guide for every advertised topic', () => {
    for (const topic of GUIDE_TOPICS) {
      const content = store.getGuide(topic);
      expect(content, `missing guide: ${topic}`).toBeTruthy();
    }
  });

  it('lists the 7 canonical variant types with API-creatable flags', () => {
    const types = store.listVariantTypes();
    expect(types.length).toBe(7);
    const creatable = types.filter((t) => t.apiCreatable).map((t) => t.type).sort();
    expect(creatable).toEqual(['preview', 'transcode']);
  });

  it('search returns ranked hits for a real query', () => {
    const hits = store.searchDocs('play session signed url', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[hits.length - 1].score);
  });
});

describe('knowledge tools', () => {
  it('exposes the expected read-only tools', () => {
    for (const name of [
      'adn_about',
      'adn_search_docs',
      'adn_list_operations',
      'adn_get_operation',
      'adn_get_guide',
      'adn_list_output_types',
      'adn_list_variant_types',
    ]) {
      expect(byName.has(name), `missing tool: ${name}`).toBe(true);
      expect(byName.get(name)!.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('canonical and legacy output-type tools return the same catalog', () => {
    const canonical = byName.get('adn_list_output_types')!.handler({});
    const legacy = byName.get('adn_list_variant_types')!.handler({});
    expect(canonical).toEqual(legacy);
    expect((canonical as any).outputTypes.length).toBe(7);
  });

  it('adn_get_operation throws a helpful error for unknown ids', () => {
    expect(() => byName.get('adn_get_operation')!.handler({ operationId: 'bogus' })).toThrow(
      /adn_list_operations/,
    );
  });

  it('adn_get_guide rejects unknown topics via schema', () => {
    const parsed = byName.get('adn_get_guide')!.inputSchema.safeParse({ topic: 'nope' });
    expect(parsed.success).toBe(false);
  });

  it('serves the webhooks guide with REST config tools', () => {
    const guide = byName.get('adn_get_guide')!.handler({
      topic: 'webhooks',
    }) as { topic: string; content: string };
    expect(guide.topic).toBe('webhooks');
    expect(guide.content).toMatch(/adn_get_webhooks/);
    expect(guide.content).toMatch(/adn_set_webhooks/);
    expect(guide.content).toMatch(/adn_test_webhook/);
    expect(guide.content).toMatch(/X-ADN-Event/);
    expect(guide.content).toMatch(/unsigned/i);
  });

  it('serves the web-components guide and finds it via search', () => {
    const guide = byName.get('adn_get_guide')!.handler({
      topic: 'web-components',
    }) as { topic: string; content: string };
    expect(guide.topic).toBe('web-components');
    expect(guide.content).toMatch(/adn_build_player_embed/);
    expect(guide.content).toMatch(/audiodn-player/);
    expect(guide.content).toMatch(/x-small/);

    const hits = store.searchDocs('audiodn-player embed variants', 5);
    expect(hits.some((h) => h.source === 'guide' && /web-components/i.test(h.title))).toBe(
      true,
    );
  });

  it('serves the native-playback guide and finds it via search', () => {
    const guide = byName.get('adn_get_guide')!.handler({
      topic: 'native-playback',
    }) as { topic: string; content: string };
    expect(guide.topic).toBe('native-playback');
    expect(guide.content).toMatch(/play session/i);
    expect(guide.content).toMatch(/Client-Side.*Player/i);
    expect(guide.content).toMatch(/URL Signing/i);
    expect(guide.content).toMatch(/verify/);

    const appHits = store.searchDocs('play track native mobile app', 5);
    expect(
      appHits.some((h) => h.source === 'guide' && /native-playback/i.test(h.title)),
    ).toBe(true);

    const signHits = store.searchDocs('pre-sign url without play session', 5);
    expect(
      signHits.some((h) => h.source === 'guide' && /native-playback/i.test(h.title)),
    ).toBe(true);
  });
});
