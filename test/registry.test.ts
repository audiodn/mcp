import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AdnClient } from '../src/client.js';
import { loadDocStore } from '../src/docs/load-node.js';
import { SERVER_INSTRUCTIONS } from '../src/instructions.js';
import { buildServer } from '../src/server.js';

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

async function connect(withClient = true): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({
    client: withClient ? new AdnClient({ apiKey: 'adn_test' }) : undefined,
    store: loadDocStore(),
    version: '9.9.9',
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

let harness: Harness | null = null;
afterEach(async () => {
  if (harness) await harness.close();
  harness = null;
});

function firstText(res: any): string {
  return res.content?.find((c: any) => c.type === 'text')?.text ?? '';
}

describe('server registry', () => {
  it('reports the injected server version', async () => {
    harness = await connect();
    expect(harness.client.getServerVersion()?.version).toBe('9.9.9');
  });

  it('exposes knowledge + API tools including deletes and create_track', async () => {
    harness = await connect();
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('adn_list_collections');
    expect(names).toContain('adn_search_docs');
    expect(names).toContain('adn_list_operations');
    expect(names).toContain('adn_delete_collection');
    expect(names).toContain('adn_delete_creator');
    expect(names).toContain('adn_delete_track');
    expect(names).toContain('adn_create_track');
    expect(names).toContain('adn_update_track');
    expect(names).toContain('adn_list_output_presets');
    expect(names).toContain('adn_get_output_preset');
    expect(names).toContain('adn_create_track_output');
    expect(names).toContain('adn_create_track_variant');
    expect(names).toContain('adn_get_play_track');
    expect(names).toContain('adn_get_organization');
    expect(names).toContain('adn_create_client_key');
    expect(names).toContain('adn_create_collection_cover');
    expect(names).toContain('adn_create_track_cover');
    expect(names).toContain('adn_get_variant');
    expect(names).toContain('adn_list_variants');
    expect(names).toContain('adn_get_play_download');
    expect(names).toContain('adn_list_output_types');
  });

  it('exposes only knowledge tools when no API client is configured', async () => {
    harness = await connect(false);
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('adn_about');
    expect(names).toContain('adn_search_docs');
    expect(names.some((n) => n.includes('create') || n.includes('list_creators'))).toBe(
      false,
    );
  });

  it('advertises server instructions on initialize', async () => {
    harness = await connect();
    const instructions = harness.client.getInstructions();
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions).toMatch(/track_status_id/);
    expect(instructions).toMatch(/confirm with the user/);
  });

  it('annotates tools (read-only vs write) and requires play-session variants', async () => {
    harness = await connect();
    const { tools } = await harness.client.listTools();
    const getTrack = tools.find((t) => t.name === 'adn_get_track');
    expect(getTrack?.annotations?.readOnlyHint).toBe(true);

    const playSession = tools.find((t) => t.name === 'adn_create_play_session');
    const scopeEnum = (playSession?.inputSchema as any)?.properties?.scope?.enum;
    expect(scopeEnum).toEqual(['collection', 'track']);
    expect((playSession?.inputSchema as any)?.properties?.playlist_id).toBeUndefined();
    expect((playSession?.inputSchema as any)?.required).toEqual(
      expect.arrayContaining(['scope', 'variants']),
    );
    expect(
      (playSession?.inputSchema as any)?.properties?.variants?.minItems,
    ).toBe(1);

    const upload = tools.find((t) => t.name === 'adn_create_upload_session');
    expect(
      (upload?.inputSchema as any)?.properties?.track?.properties?.file_name,
    ).toBeTruthy();
    expect(
      (upload?.inputSchema as any)?.properties?.expires_in?.maximum,
    ).toBe(86400);
  });

  it('exposes delete tools with destructiveHint', async () => {
    harness = await connect();
    const { tools } = await harness.client.listTools();
    const del = tools.find((t) => t.name === 'adn_delete_collection');
    expect(del).toBeTruthy();
    expect(del?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'adn_delete_track')?.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it('runs an offline knowledge tool without any network', async () => {
    harness = await connect();
    const res: any = await harness.client.callTool({
      name: 'adn_list_variant_types',
      arguments: {},
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(res));
    expect(parsed.variantTypes.length).toBe(7);
  });

  it('rejects invalid arguments', async () => {
    harness = await connect();
    const res: any = await harness.client.callTool({
      name: 'adn_get_operation',
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toMatch(/Invalid arguments/);
  });
});

describe('resources', () => {
  it('lists and reads OpenAPI + guides', async () => {
    harness = await connect();
    const { resources } = await harness.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('audiodn://openapi.json');
    expect(uris).toContain('audiodn://llms-full.txt');
    expect(uris).toContain('audiodn://guide/authentication');

    const openapi: any = await harness.client.readResource({
      uri: 'audiodn://openapi.json',
    });
    expect(openapi.contents?.[0]?.text).toMatch(/openapi/);
  });
});
