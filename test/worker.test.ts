import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadDocStore } from '../src/docs/load-node.js';
import {
  createFetchHandler,
  createRequestServer,
  landingHtml,
  readApiKey,
  type Env,
  type Serve,
} from '../worker/handler.js';

// The Worker entry (worker/index.ts) imports `agents/mcp`, which uses the
// `cloudflare:` module scheme and cannot load in plain Node. We therefore test
// worker/handler.ts — the Cloudflare-free request logic — and drive the real
// McpServer through an in-memory transport via an injected `serve`.

const store = loadDocStore();
const env: Env = {};
const ctx = {} as ExecutionContext;

async function toolNames(server: McpServer): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name).sort();
}

/** A stand-in for the real `createMcpHandler` serve: routes only `/mcp` and
 *  reports the tools registered on the per-request server. */
const serve: Serve = async (server, request) => {
  const url = new URL(request.url);
  if (url.pathname !== '/mcp') {
    return new Response('Not found', { status: 404 });
  }
  return Response.json({ tools: await toolNames(server) });
};

describe('worker: createRequestServer tool visibility', () => {
  it('registers only read-only knowledge tools without a key', async () => {
    const names = await toolNames(createRequestServer(store, {}));
    expect(names).toContain('adn_about');
    expect(names).toContain('adn_search_docs');
    expect(names).toContain('adn_get_operation');
    expect(names.some((n) => n.startsWith('adn_list_creators'))).toBe(false);
    expect(names.some((n) => n.startsWith('adn_create'))).toBe(false);
  });

  it('adds live API tools when a key is supplied, but never delete tools', async () => {
    const names = await toolNames(createRequestServer(store, { apiKey: 'adn_test' }));
    expect(names).toContain('adn_about');
    expect(names).toContain('adn_list_creators');
    expect(names).toContain('adn_create_upload_session');
    expect(names.some((n) => n.includes('delete'))).toBe(false);
  });
});

describe('worker: readApiKey', () => {
  it('reads X-ADN-API-Key', () => {
    const req = new Request('https://x/mcp', {
      headers: { 'X-ADN-API-Key': 'adn_abc' },
    });
    expect(readApiKey(req)).toBe('adn_abc');
  });

  it('falls back to Authorization: Bearer', () => {
    const req = new Request('https://x/mcp', {
      headers: { Authorization: 'Bearer adn_xyz' },
    });
    expect(readApiKey(req)).toBe('adn_xyz');
  });

  it('returns undefined with no key header', () => {
    expect(readApiKey(new Request('https://x/mcp'))).toBeUndefined();
  });
});

describe('worker: createFetchHandler', () => {
  const handler = createFetchHandler(store, serve);

  it('serves info JSON at /health', async () => {
    const res = await handler(new Request('https://x/health'), env, ctx);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe('audiodn-mcp');
    expect(body.version).toBe(store.about().serverVersion);
    expect(body.transport).toBe('streamable-http');
    expect(body.endpoint).toBe('/mcp');
  });

  it('serves info JSON at / for non-HTML clients', async () => {
    const res = await handler(
      new Request('https://x/', { headers: { accept: '*/*' } }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await res.json() as any).name).toBe('audiodn-mcp');
  });

  it('serves an HTML landing page at / for browsers', async () => {
    const res = await handler(
      new Request('https://x/', { headers: { accept: 'text/html' } }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('AudioDN MCP server');
    expect(html).toContain('https://mcp.audiodelivery.net/mcp');
    expect(html).toContain('npx @audiodn/mcp');
  });

  it('/mcp without a key exposes only knowledge tools', async () => {
    const res = await handler(
      new Request('https://x/mcp', { method: 'POST' }),
      env,
      ctx,
    );
    const body: any = await res.json();
    expect(body.tools).toContain('adn_about');
    expect(body.tools).not.toContain('adn_list_creators');
  });

  it('/mcp with X-ADN-API-Key exposes live API tools', async () => {
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { 'X-ADN-API-Key': 'adn_test' },
      }),
      env,
      ctx,
    );
    const body: any = await res.json();
    expect(body.tools).toContain('adn_list_creators');
    expect(body.tools.some((n: string) => n.includes('delete'))).toBe(false);
  });

  it('/mcp with Authorization: Bearer exposes live API tools', async () => {
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer adn_test' },
      }),
      env,
      ctx,
    );
    expect((await res.json() as any).tools).toContain('adn_list_creators');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await handler(new Request('https://x/nope'), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('worker: landingHtml', () => {
  it('is valid-looking HTML with the key facts', () => {
    const html = landingHtml(store);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(store.about().serverVersion);
    expect(html).toContain('/health');
    expect(html).toContain('X-ADN-API-Key');
  });
});
