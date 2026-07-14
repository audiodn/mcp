import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { AdnClient } from '../src/client.js';
import type { DocStore } from '../src/docs/store.js';
import { createApiTools } from '../src/tools/api-tools.js';
import { createKnowledgeTools } from '../src/tools/knowledge-tools.js';
import { runToolHandler } from '../src/tools/run.js';
import type { ToolDef } from '../src/tools/types.js';

/**
 * Worker request handling, kept free of any Cloudflare/`agents` imports so it
 * can be unit-tested in plain Node. The Worker entry (index.ts) wires this to
 * `createMcpHandler` from `agents/mcp`.
 */

export interface Env {
  ADN_API_BASE_URL?: string;
}

export interface RequestServerOptions {
  /** Bring-your-own AudioDN key. When absent, only knowledge tools register. */
  apiKey?: string;
  baseUrl?: string;
  version?: string;
}

/** Read the caller's AudioDN key from a header. Never stored server-side. */
export function readApiKey(request: Request): string | undefined {
  const direct = request.headers.get('x-adn-api-key');
  if (direct && direct.trim()) return direct.trim();
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * The tools exposed on the hosted endpoint for a given request: knowledge tools
 * always, live API tools only when a key is supplied. Destructive delete tools
 * are never exposed on the hosted endpoint.
 */
export function selectTools(store: DocStore, opts: RequestServerOptions): ToolDef[] {
  const tools: ToolDef[] = [...createKnowledgeTools(store)];
  if (opts.apiKey) {
    const client = new AdnClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    tools.push(...createApiTools(client).filter((t) => t.gated !== 'delete'));
  }
  return tools;
}

/** Build a fresh McpServer per request (required for stateless safety). */
export function createRequestServer(
  store: DocStore,
  opts: RequestServerOptions = {},
): McpServer {
  const version = opts.version ?? store.about().serverVersion;
  const server = new McpServer({ name: 'audiodn-mcp', version });

  for (const tool of selectTools(store, opts)) {
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

  return server;
}

const HOSTED_URL = 'https://mcp.audiodelivery.net/mcp';
const NPM_URL = 'https://www.npmjs.com/package/@audiodn/mcp';
const DOCS_URL = 'https://audiodeliverynetwork.com/for-ai-agents';

/** Machine-readable info served at `/health` (and `/` for non-HTML clients). */
export function infoPayload(store: DocStore) {
  const about = store.about();
  return {
    name: 'audiodn-mcp',
    version: about.serverVersion,
    description:
      'AudioDN Model Context Protocol server (hosted, Streamable HTTP). Knowledge/doc tools work with no key; send your AudioDN API key to enable live API tools.',
    transport: 'streamable-http',
    endpoint: '/mcp',
    url: HOSTED_URL,
    auth: {
      description:
        'Bring your own AudioDN API key. Knowledge tools work without a key; live API tools activate when a key is sent.',
      headers: [
        'Authorization: Bearer <ADN_API_KEY>',
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
  playback sessions and variants — plus offline, grounded API docs and guides so
  agents use the correct endpoints instead of guessing.</p>

  <h2>Hosted endpoint (Streamable HTTP)</h2>
  <pre>${escapeHtml(HOSTED_URL)}</pre>
  <p>The endpoint is public and stores no secrets. Knowledge/doc tools work with
  <strong>no key</strong>. To enable the live API tools, send your AudioDN API
  key on every request as either header:</p>
  <pre>Authorization: Bearer adn_...
# or
X-ADN-API-Key: adn_...</pre>
  <p>Destructive delete tools are never exposed on the hosted endpoint.</p>

  <h2>Run locally (stdio)</h2>
  <pre>ADN_API_KEY=adn_... npx @audiodn/mcp</pre>

  <h2>Links</h2>
  <ul>
    <li><a href="${NPM_URL}">npm: @audiodn/mcp</a></li>
    <li><a href="${DOCS_URL}">AudioDN for AI agents</a></li>
    <li><a href="/health">/health</a> (machine-readable JSON)</li>
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

/**
 * The Worker fetch handler. `serve` is injected so this stays testable without
 * the `agents` runtime: index.ts passes a `createMcpHandler`-backed serve.
 */
export function createFetchHandler(store: DocStore, serve: Serve) {
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json(infoPayload(store));
    }

    if (request.method === 'GET' && url.pathname === '/') {
      // Browsers get the landing page; tooling (curl/agents) gets JSON.
      const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
      return wantsHtml
        ? new Response(landingHtml(store), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        : Response.json(infoPayload(store));
    }

    const apiKey = readApiKey(request);
    const server = createRequestServer(store, {
      apiKey,
      baseUrl: env?.ADN_API_BASE_URL,
    });

    return serve(server, request, env, ctx);
  };
}
