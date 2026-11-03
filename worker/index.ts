import { createMcpHandler } from 'agents/mcp';
import { store } from './assets.js';
import { createFetchHandler, type Env, type Serve } from './handler.js';

/**
 * Cloudflare Worker entry: serves the AudioDN MCP tool set over Streamable HTTP
 * at `/mcp` (stateless, no Durable Objects) plus OAuth discovery and token
 * endpoints. Authenticated sessions use OAuth access tokens (account login) or
 * a legacy API Access key. Grant material lives in KV, encrypted — OAuth tokens
 * are never forwarded to the AudioDN API.
 */

const corsOptions = {
  origin: '*',
  methods: 'GET, POST, OPTIONS',
  headers:
    'Content-Type, Authorization, X-ADN-API-Key, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  exposeHeaders: 'Mcp-Session-Id',
  maxAge: 86400,
};

const serve: Serve = (server, request, env, ctx) =>
  createMcpHandler(server, { route: '/mcp', corsOptions })(request, env, ctx);

const fetchHandler = createFetchHandler(store, serve);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return fetchHandler(request, env, ctx);
  },
};
