import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { normalizeApiKey } from '../src/api-key.js';
import { AdnClient } from '../src/client.js';
import type { DocStore } from '../src/docs/store.js';
import { SERVER_INSTRUCTIONS } from '../src/instructions.js';
import { listResourceDescriptors, readResource } from '../src/resources.js';
import { selectTools } from '../src/tools/select.js';
import { runToolHandler } from '../src/tools/run.js';
import type { ToolDef } from '../src/tools/types.js';
import {
  AS_META_PATH,
  JWKS_PATH,
  PRM_MCP_PATH,
  PRM_PATH,
} from './oauth/constants.js';
import { looksLikeJwt } from './oauth/crypto.js';
import {
  authorizationServerMetadata,
  jwksDocument,
  protectedResourceMetadata,
  unauthorizedResponse,
} from './oauth/metadata.js';
import { resolveRequestAuth } from './oauth/resolve.js';
import {
  handleApprove,
  handleAuthorize,
  handleDevConsent,
  handleRegister,
  handleToken,
  handleTransactionInfo,
  type OAuthEnv,
} from './oauth/routes.js';
import type { OAuthKv } from './oauth/store.js';

/**
 * Worker request handling, kept free of any Cloudflare/`agents` imports so it
 * can be unit-tested in plain Node. The Worker entry (index.ts) wires this to
 * `createMcpHandler` from `agents/mcp`.
 */

export interface Env extends OAuthEnv {
  ADN_API_BASE_URL?: string;
  MCP_OAUTH?: OAuthKv;
}

export interface RequestServerOptions {
  /** Resolved AudioDN API Access key (from OAuth grant or legacy header). */
  apiKey: string;
  baseUrl?: string;
  version?: string;
}

/** Legacy helper: returns non-JWT API keys from headers (tests + debugging). */
export function readApiKey(request: Request): string | undefined {
  const direct = request.headers.get('x-adn-api-key');
  if (direct?.trim()) {
    return normalizeApiKey(direct);
  }
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) {
      const value = match[1]!.trim();
      if (looksLikeJwt(value)) return undefined;
      return normalizeApiKey(value);
    }
  }
  return undefined;
}

/** Hosted delete opt-in removed — deletes are always available when authenticated. */
export function readAllowDelete(_request: Request): boolean {
  return true;
}

/**
 * Tools for an authenticated hosted request: knowledge + full live API (incl. deletes).
 */
export function selectHostedTools(
  store: DocStore,
  opts: RequestServerOptions,
): ToolDef[] {
  const client = new AdnClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  return selectTools(store, { client });
}

/** Build a fresh McpServer per request (required for stateless safety). */
export function createRequestServer(
  store: DocStore,
  opts: RequestServerOptions,
): McpServer {
  const version = opts.version ?? store.about().serverVersion;
  const server = new McpServer(
    { name: 'audiodn-mcp', version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of selectHostedTools(store, opts)) {
    const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: shape,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      (args: unknown) => runToolHandler(tool, args) as any,
    );
  }

  for (const resource of listResourceDescriptors()) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        mimeType: resource.mimeType,
        description: resource.name,
      },
      async (uri) => {
        const uriString = typeof uri === 'string' ? uri : uri.href;
        const content = readResource(store, uriString);
        if (!content) {
          throw new Error(`Unknown resource: ${uriString}`);
        }
        return {
          contents: [
            {
              uri: content.uri,
              mimeType: content.mimeType,
              text: content.text,
            },
          ],
        };
      },
    );
  }

  return server;
}

const HOSTED_URL = 'https://mcp.audiodelivery.net/mcp';
const NPM_URL = 'https://www.npmjs.com/package/@audiodn/mcp';
const DOCS_URL = 'https://audiodeliverynetwork.com/docs/mcp';

/** Machine-readable info served at `/health` (and `/` for non-HTML clients). */
export function infoPayload(store: DocStore) {
  const about = store.about();
  return {
    name: 'audiodn-mcp',
    version: about.serverVersion,
    description:
      'AudioDN Model Context Protocol server (hosted, Streamable HTTP). Sign in with your AudioDN account via OAuth (MCP authorization). Legacy API Access keys still work as Bearer tokens. Local stdio uses ADN_API_KEY.',
    transport: 'streamable-http',
    endpoint: '/mcp',
    url: HOSTED_URL,
    auth: {
      description:
        'OAuth 2.1 (authorization code + PKCE) against your AudioDN account, or a legacy API Access key via Authorization: Bearer / X-ADN-API-Key. Knowledge and live API tools (including deletes) require authentication on the hosted endpoint.',
      oauth: {
        protected_resource_metadata: `https://mcp.audiodelivery.net${PRM_PATH}`,
        authorization_server_metadata: `https://mcp.audiodelivery.net${AS_META_PATH}`,
        resource: HOSTED_URL,
      },
      headers: [
        'Authorization: Bearer <oauth-access-token-or-ADN_API_KEY>',
        'X-ADN-API-Key: <ADN_API_KEY>',
      ],
    },
    openapiVersion: about.openapiVersion,
    npm: NPM_URL,
    docs: DOCS_URL,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/** Human-friendly landing page served at `/` for browsers. */
export function landingHtml(store: DocStore): string {
  const { serverVersion, openapiVersion } = store.about();
  const v = escapeHtml(serverVersion);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="index,follow" />
<title>AudioDN MCP server</title>
<meta name="description" content="AudioDN Model Context Protocol server — Streamable HTTP endpoint and npx stdio server for AI agents." />
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 2.5rem 1.25rem; max-width: 760px; margin-inline: auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
  .sub { opacity: .7; margin: 0 0 1.5rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: rgba(127,127,127,.12); padding: .9rem 1rem; border-radius: 8px; overflow-x: auto; }
  code:not(pre code) { background: rgba(127,127,127,.14); padding: .1rem .35rem; border-radius: 4px; }
  a { color: #2563eb; }
  ul { padding-left: 1.2rem; }
  .foot { margin-top: 2.5rem; opacity: .6; font-size: .85rem; }
</style>
</head>
<body>
  <h1>AudioDN MCP server</h1>
  <p class="sub">Model Context Protocol server for AudioDN · v${v} · OpenAPI ${escapeHtml(openapiVersion)}</p>

  <p>Configure AudioDN audio hosting from your AI agent — upload sessions, tracks,
  playback sessions and variants — plus grounded API docs and guides so
  agents use the correct endpoints instead of guessing.</p>

  <h2>Hosted endpoint (Streamable HTTP)</h2>
  <pre>${escapeHtml(HOSTED_URL)}</pre>
  <p>Compatible MCP clients sign in with your AudioDN account via <strong>OAuth</strong>
  (authorization code + PKCE). Point the client at the URL above with no pasted API key.
  A legacy API Access key still works as <code>Authorization: Bearer</code> or
  <code>X-ADN-API-Key</code> for existing configs.</p>
  <p>Authenticated sessions expose the full live API tool set, including destructive
  deletes (clients should confirm before calling them).</p>

  <h2>Run locally (stdio)</h2>
  <pre>ADN_API_KEY=adn_... npx @audiodn/mcp</pre>
  <p>Knowledge tools work without a key; set <code>ADN_API_KEY</code> for live API tools
  (including deletes). Prefer the hosted URL when you want account login instead of a key.</p>

  <h2>Links</h2>
  <ul>
    <li><a href="${NPM_URL}">npm: @audiodn/mcp</a></li>
    <li><a href="${DOCS_URL}">AudioDN MCP docs</a></li>
    <li><a href="/health">/health</a> (machine-readable JSON)</li>
    <li><a href="${PRM_PATH}">OAuth protected resource metadata</a></li>
  </ul>

  <p class="foot">Streamable HTTP MCP endpoint at <code>/mcp</code>.</p>
</body>
</html>`;
}

export type Serve = (
  server: McpServer,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response> | Response;

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

/**
 * The Worker fetch handler. `serve` is injected so this stays testable without
 * the `agents` runtime: index.ts passes a `createMcpHandler`-backed serve.
 */
export function createFetchHandler(store: DocStore, serve: Serve) {
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers':
            'Content-Type, Authorization, X-ADN-API-Key, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
          'access-control-max-age': '86400',
        },
      });
    }

    if (request.method === 'GET' && path === '/health') {
      return Response.json(infoPayload(store));
    }

    if (request.method === 'GET' && path === '/') {
      const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
      return wantsHtml
        ? new Response(landingHtml(store), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        : Response.json(infoPayload(store));
    }

    // --- OAuth discovery ---
    if (
      request.method === 'GET' &&
      (path === PRM_PATH || path === PRM_MCP_PATH)
    ) {
      return corsJson(protectedResourceMetadata(env));
    }
    if (request.method === 'GET' && path === AS_META_PATH) {
      return corsJson(authorizationServerMetadata(env));
    }
    if (request.method === 'GET' && path === JWKS_PATH) {
      return corsJson(jwksDocument());
    }

    // --- OAuth endpoints ---
    if (path === '/authorize') {
      return handleAuthorize(request, env);
    }
    if (path === '/token') {
      return handleToken(request, env);
    }
    if (path === '/register') {
      return handleRegister(request, env);
    }
    if (path === '/oauth/transaction') {
      return handleTransactionInfo(request, env);
    }
    if (path === '/oauth/approve') {
      return handleApprove(request, env);
    }
    if (path === '/oauth/dev-consent') {
      return handleDevConsent(request, env);
    }

    // --- MCP endpoint: require auth ---
    if (path === '/mcp') {
      const secrets =
        env.MCP_JWT_SECRET && env.MCP_GRANT_ENCRYPTION_KEY
          ? {
              jwtSecret: env.MCP_JWT_SECRET,
              grantEncryptionKey: env.MCP_GRANT_ENCRYPTION_KEY,
            }
          : undefined;
      const auth = await resolveRequestAuth(request, {
        kv: env.MCP_OAUTH,
        secrets,
        configEnv: env,
      });

      if (auth.invalid || !auth.apiKey) {
        return unauthorizedResponse(
          auth.invalid
            ? 'Invalid or expired credentials'
            : 'Authorization required',
          env,
        );
      }

      const server = createRequestServer(store, {
        apiKey: auth.apiKey,
        baseUrl: env?.ADN_API_BASE_URL,
      });

      return serve(server, request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  };
}
