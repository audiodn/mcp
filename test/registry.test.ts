import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AdnClient } from '../src/client.js';
import { DocStore } from '../src/docs/store.js';
import { buildServer } from '../src/server.js';

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

async function connect(allowDelete: boolean): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({
    client: new AdnClient({ apiKey: 'adn_test' }),
    store: DocStore.load(),
    version: '9.9.9',
    allowDelete,
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
    harness = await connect(false);
    expect(harness.client.getServerVersion()?.version).toBe('9.9.9');
  });

  it('hides delete tools by default and exposes knowledge + API tools', async () => {
    harness = await connect(false);
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('adn_list_collections');
    expect(names).toContain('adn_search_docs');
    expect(names).toContain('adn_list_operations');
    expect(names).not.toContain('adn_delete_collection');
    expect(names).not.toContain('adn_delete_creator');
  });

  it('annotates tools (read-only vs write) and drops the playlist scope', async () => {
    harness = await connect(false);
    const { tools } = await harness.client.listTools();
    const getTrack = tools.find((t) => t.name === 'adn_get_track');
    expect(getTrack?.annotations?.readOnlyHint).toBe(true);

    const playSession = tools.find((t) => t.name === 'adn_create_play_session');
    const scopeEnum = (playSession?.inputSchema as any)?.properties?.scope?.enum;
    expect(scopeEnum).toEqual(['collection', 'track']);
    expect((playSession?.inputSchema as any)?.properties?.playlist_id).toBeUndefined();
  });

  it('exposes delete tools with destructiveHint when enabled', async () => {
    harness = await connect(true);
    const { tools } = await harness.client.listTools();
    const del = tools.find((t) => t.name === 'adn_delete_collection');
    expect(del).toBeTruthy();
    expect(del?.annotations?.destructiveHint).toBe(true);
  });

  it('refuses a gated delete when not enabled, with a helpful message', async () => {
    harness = await connect(false);
    const res: any = await harness.client.callTool({
      name: 'adn_delete_collection',
      arguments: { collection_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toMatch(/ADN_MCP_ALLOW_DELETE=1/);
  });

  it('runs an offline knowledge tool without any network', async () => {
    harness = await connect(false);
    const res: any = await harness.client.callTool({
      name: 'adn_list_variant_types',
      arguments: {},
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(res));
    expect(parsed.variantTypes.length).toBe(7);
  });

  it('rejects invalid arguments', async () => {
    harness = await connect(false);
    const res: any = await harness.client.callTool({
      name: 'adn_get_operation',
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toMatch(/Invalid arguments/);
  });
});

describe('server resources', () => {
  it('lists openapi + guide resources and reads openapi', async () => {
    harness = await connect(false);
    const { resources } = await harness.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('audiodn://openapi.json');
    expect(uris).toContain('audiodn://guide/upload');

    const read: any = await harness.client.readResource({ uri: 'audiodn://openapi.json' });
    const spec = JSON.parse(read.contents[0].text);
    expect(spec.info.version).toBe('1.0.0');
  });
});
