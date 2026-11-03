import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_INSTRUCTIONS } from '../src/instructions.js';
import { loadDocStore } from '../src/docs/load-node.js';
import {
  createFetchHandler,
  createRequestServer,
  landingHtml,
  readApiKey,
  type Env,
  type Serve,
} from '../worker/handler.js';
import { CANONICAL_RESOURCE, ISSUER } from '../worker/oauth/constants.js';
import {
  encryptSecret,
  signJwt,
  sha256Base64Url,
} from '../worker/oauth/crypto.js';
import { createMemoryKv, putGrant } from '../worker/oauth/store.js';

const store = loadDocStore();
const ctx = {} as ExecutionContext;

const TEST_JWT = 'test-jwt-secret-at-least-32-chars-long!!';
const TEST_GRANT = 'test-grant-encryption-key-32chars!!';
const TEST_HMAC = 'test-internal-hmac-secret-value!!';

function testEnv(kv = createMemoryKv()): Env {
  return {
    MCP_OAUTH: kv,
    MCP_JWT_SECRET: TEST_JWT,
    MCP_GRANT_ENCRYPTION_KEY: TEST_GRANT,
    MCP_INTERNAL_HMAC: TEST_HMAC,
    ACCOUNT_CONSENT_BASE_URL: 'https://account.example/connect/mcp',
  };
}

async function inspectServer(server: McpServer): Promise<{
  tools: string[];
  resources: string[];
  instructions?: string;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  const { resources } = await client.listResources();
  const instructions = client.getInstructions() ?? undefined;
  await client.close();
  return {
    tools: tools.map((t) => t.name).sort(),
    resources: resources.map((r) => r.uri).sort(),
    instructions,
  };
}

async function toolNames(server: McpServer): Promise<string[]> {
  return (await inspectServer(server)).tools;
}

const serve: Serve = async (server, request) => {
  const url = new URL(request.url);
  if (url.pathname !== '/mcp') {
    return new Response('Not found', { status: 404 });
  }
  return Response.json({ tools: await toolNames(server) });
};

describe('worker: createRequestServer tool visibility', () => {
  it('exposes knowledge + live API + deletes when authenticated', async () => {
    const names = await toolNames(
      createRequestServer(store, { apiKey: 'adn_test' }),
    );
    expect(names).toContain('adn_about');
    expect(names).toContain('adn_list_creators');
    expect(names).toContain('adn_create_upload_session');
    expect(names).toContain('adn_create_track');
    expect(names).toContain('adn_delete_collection');
    expect(names).toContain('adn_delete_track');
    expect(names).toContain('adn_get_organization');
  });

  it('registers canonical resources and instructions', async () => {
    const info = await inspectServer(
      createRequestServer(store, { apiKey: 'adn_test' }),
    );
    expect(info.resources).toContain('audiodn://openapi.json');
    expect(info.resources).toContain('audiodn://guide/upload');
    expect(info.instructions).toBe(SERVER_INSTRUCTIONS);
  });
});

describe('worker: readApiKey', () => {
  it('reads X-ADN-API-Key', () => {
    const req = new Request('https://x/mcp', {
      headers: { 'X-ADN-API-Key': 'adn_abc' },
    });
    expect(readApiKey(req)).toBe('adn_abc');
  });

  it('falls back to Authorization: Bearer for non-JWT keys', () => {
    const req = new Request('https://x/mcp', {
      headers: { Authorization: 'Bearer adn_xyz' },
    });
    expect(readApiKey(req)).toBe('adn_xyz');
  });

  it('returns undefined with no key header', () => {
    expect(readApiKey(new Request('https://x/mcp'))).toBeUndefined();
  });

  it('ignores empty and uninterpolated placeholder keys', () => {
    expect(
      readApiKey(
        new Request('https://x/mcp', {
          headers: { Authorization: 'Bearer ${env:ADN_API_KEY}' },
        }),
      ),
    ).toBeUndefined();
  });
});

describe('worker: createFetchHandler', () => {
  const env = testEnv();
  const handler = createFetchHandler(store, serve);

  it('serves info JSON at /health', async () => {
    const res = await handler(new Request('https://x/health'), env, ctx);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe('audiodn-mcp');
    expect(body.auth.oauth.resource).toBe(CANONICAL_RESOURCE);
  });

  it('serves protected resource metadata', async () => {
    const res = await handler(
      new Request('https://mcp.audiodelivery.net/.well-known/oauth-protected-resource'),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.resource).toBe(CANONICAL_RESOURCE);
    expect(body.authorization_servers).toContain(ISSUER);
  });

  it('serves authorization server metadata with PKCE S256', async () => {
    const res = await handler(
      new Request('https://mcp.audiodelivery.net/.well-known/oauth-authorization-server'),
      env,
      ctx,
    );
    const body: any = await res.json();
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.authorization_endpoint).toContain('/authorize');
    expect(body.client_id_metadata_document_supported).toBe(true);
  });

  it('/mcp without credentials returns 401 with resource_metadata', async () => {
    const res = await handler(
      new Request('https://x/mcp', { method: 'POST' }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    const www = res.headers.get('www-authenticate') || '';
    expect(www).toMatch(/resource_metadata=/);
    expect(www).toMatch(/scope="account"/);
  });

  it('/mcp with placeholder Authorization returns 401', async () => {
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer ${env:ADN_API_KEY}' },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('/mcp with legacy API key exposes live API + delete tools', async () => {
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { 'X-ADN-API-Key': 'adn_test' },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tools).toContain('adn_list_creators');
    expect(body.tools).toContain('adn_delete_collection');
    expect(body.tools).toContain('adn_create_track');
  });

  it('/mcp with OAuth access token resolves the grant API key', async () => {
    const kv = createMemoryKv();
    const localEnv = testEnv(kv);
    const connectionId = 'conn_test_1';
    const apiKey = 'legacy_style_api_key_value_xxxx';
    await putGrant(kv, {
      connectionId,
      organizationId: '00000000-0000-4000-8000-000000000099',
      encryptedApiKey: await encryptSecret(apiKey, TEST_GRANT),
      clientId: 'https://client.example/mcp.json',
      clientName: 'Test Client',
      createdAt: Date.now(),
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss: ISSUER,
        aud: CANONICAL_RESOURCE,
        sub: connectionId,
        scope: 'account',
        iat: now,
        exp: now + 900,
      },
      TEST_JWT,
    );
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      localEnv,
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json() as any).tools).toContain('adn_list_creators');
  });

  it('/mcp with JWT for wrong audience returns 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss: ISSUER,
        aud: 'https://other.example/mcp',
        sub: 'conn',
        scope: 'account',
        iat: now,
        exp: now + 900,
      },
      TEST_JWT,
    );
    const res = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('rejects authorize without S256 PKCE', async () => {
    const res = await handler(
      new Request(
        'https://mcp.audiodelivery.net/authorize?response_type=code&client_id=x&redirect_uri=http://127.0.0.1/cb&code_challenge=abc&code_challenge_method=plain&state=s&resource=' +
          encodeURIComponent(CANONICAL_RESOURCE),
      ),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe('invalid_request');
  });

  it('rejects authorize with wrong resource', async () => {
    await kvPutClient(env);
    const res = await handler(
      new Request(
        'https://mcp.audiodelivery.net/authorize?response_type=code&client_id=dcr_testclient&redirect_uri=http://127.0.0.1:3000/cb&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256&state=s&resource=https%3A%2F%2Fevil.example%2Fmcp',
      ),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe('invalid_target');
  });

  it('registers a dynamic client', async () => {
    const res = await handler(
      new Request('https://mcp.audiodelivery.net/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Unit Test',
          redirect_uris: ['http://127.0.0.1:3000/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.client_id).toMatch(/^dcr_/);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await handler(new Request('https://x/nope'), env, ctx);
    expect(res.status).toBe(404);
  });
});

async function kvPutClient(env: Env) {
  const { putClient } = await import('../worker/oauth/store.js');
  await putClient(env.MCP_OAUTH!, {
    clientId: 'dcr_testclient',
    clientName: 'Test',
    redirectUris: ['http://127.0.0.1:3000/cb'],
    tokenEndpointAuthMethod: 'none',
    createdAt: Date.now(),
  });
}

describe('worker: landingHtml', () => {
  it('describes OAuth account login', () => {
    const html = landingHtml(store);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(store.about().serverVersion);
    expect(html).toContain('/health');
    expect(html).toMatch(/OAuth/i);
    expect(html).not.toContain('X-ADN-Allow-Delete');
  });
});

describe('worker: oauth approve + token round-trip', () => {
  it('issues tokens after HMAC approve and PKCE exchange', async () => {
    const kv = createMemoryKv();
    const env = testEnv(kv);
    const handler = createFetchHandler(store, serve);

    const reg = await handler(
      new Request('https://mcp.audiodelivery.net/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Round Trip',
          redirect_uris: ['http://127.0.0.1:9999/cb'],
        }),
      }),
      env,
      ctx,
    );
    const { client_id } = (await reg.json()) as { client_id: string };

    const verifier = 'a'.repeat(64);
    const challenge = await sha256Base64Url(verifier);
    const authRes = await handler(
      new Request(
        `https://mcp.audiodelivery.net/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent('http://127.0.0.1:9999/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&resource=${encodeURIComponent(CANONICAL_RESOURCE)}`,
      ),
      env,
      ctx,
    );
    expect(authRes.status).toBe(302);
    const consent = new URL(authRes.headers.get('location')!);
    const txn = consent.searchParams.get('txn')!;
    expect(txn).toBeTruthy();

    const { hmacSha256Hex } = await import('../worker/oauth/crypto.js');
    const apiKey = 'orgprefix_secret_api_key_value';
    const timestamp = Date.now();
    const message = [txn, '00000000-0000-4000-8000-000000000001', '', String(timestamp), apiKey].join('\n');
    const signature = await hmacSha256Hex(TEST_HMAC, message);
    const approve = await handler(
      new Request('https://mcp.audiodelivery.net/oauth/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txn,
          organization_id: '00000000-0000-4000-8000-000000000001',
          api_key: apiKey,
          timestamp,
          signature,
        }),
      }),
      env,
      ctx,
    );
    expect(approve.status).toBe(200);
    const { redirect_uri } = (await approve.json()) as { redirect_uri: string };
    const code = new URL(redirect_uri).searchParams.get('code')!;

    const tokenRes = await handler(
      new Request('https://mcp.audiodelivery.net/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'http://127.0.0.1:9999/cb',
          client_id,
          code_verifier: verifier,
          resource: CANONICAL_RESOURCE,
        }).toString(),
      }),
      env,
      ctx,
    );
    expect(tokenRes.status).toBe(200);
    const tokens: any = await tokenRes.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const mcpRes = await handler(
      new Request('https://x/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }),
      env,
      ctx,
    );
    expect(mcpRes.status).toBe(200);
    expect((await mcpRes.json() as any).tools).toContain('adn_delete_track');
  });
});

describe('worker: local issuer / resource overrides', () => {
  it('advertises overridden resource in protected-resource metadata', async () => {
    const kv = createMemoryKv();
    const env: Env = {
      ...testEnv(kv),
      MCP_ISSUER: 'http://127.0.0.1:8788',
      MCP_RESOURCE: 'http://127.0.0.1:8788/mcp',
    };
    const handler = createFetchHandler(store, serve);
    const res = await handler(
      new Request('http://127.0.0.1:8788/.well-known/oauth-protected-resource'),
      env,
      ctx,
    );
    const body: any = await res.json();
    expect(body.resource).toBe('http://127.0.0.1:8788/mcp');
    expect(body.authorization_servers).toEqual(['http://127.0.0.1:8788']);
  });

  it('rejects JWT minted for the public audience when resource is local', async () => {
    const kv = createMemoryKv();
    const env: Env = {
      ...testEnv(kv),
      MCP_ISSUER: 'http://127.0.0.1:8788',
      MCP_RESOURCE: 'http://127.0.0.1:8788/mcp',
    };
    const handler = createFetchHandler(store, serve);
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss: ISSUER,
        aud: CANONICAL_RESOURCE,
        sub: 'conn',
        scope: 'account',
        iat: now,
        exp: now + 900,
      },
      TEST_JWT,
    );
    const res = await handler(
      new Request('http://127.0.0.1:8788/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('without MCP_DEV_MODE, /oauth/dev-consent is 404', async () => {
    const handler = createFetchHandler(store, serve);
    const res = await handler(
      new Request('https://mcp.audiodelivery.net/oauth/dev-consent?txn=x'),
      testEnv(),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('with MCP_DEV_MODE, /authorize redirects to /oauth/dev-consent', async () => {
    const kv = createMemoryKv();
    const env: Env = {
      ...testEnv(kv),
      MCP_ISSUER: 'http://127.0.0.1:8788',
      MCP_RESOURCE: 'http://127.0.0.1:8788/mcp',
      MCP_DEV_MODE: '1',
      ADN_API_KEY: 'local_test_api_key_value',
    };
    const handler = createFetchHandler(store, serve);
    const reg = await handler(
      new Request('http://127.0.0.1:8788/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Dev Mode',
          redirect_uris: ['http://127.0.0.1:9999/cb'],
        }),
      }),
      env,
      ctx,
    );
    const { client_id } = (await reg.json()) as { client_id: string };
    const challenge = await sha256Base64Url('b'.repeat(64));
    const authRes = await handler(
      new Request(
        `http://127.0.0.1:8788/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent('http://127.0.0.1:9999/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=s&resource=${encodeURIComponent('http://127.0.0.1:8788/mcp')}`,
      ),
      env,
      ctx,
    );
    expect(authRes.status).toBe(302);
    const loc = authRes.headers.get('location')!;
    expect(loc).toContain('http://127.0.0.1:8788/oauth/dev-consent?txn=');
  });
});
