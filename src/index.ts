#!/usr/bin/env node
/**
 * AudioDN MCP server.
 *
 * Exposes the ADN REST API as Model Context Protocol tools, plus offline,
 * read-only documentation/knowledge tools grounded in bundled canonical
 * snapshots (OpenAPI + llms-full), so AI agents (Cursor, Claude Desktop,
 * Claude Code, VS Code, Codex, etc.) can configure audio hosting on a user's
 * behalf and look up the correct, canonical API surface.
 *
 * Prefer the hosted endpoint (https://mcp.audiodelivery.net/mcp) for OAuth
 * account login and onboarding (no pasted API key). Stdio local/script use:
 *   ADN_API_KEY=adn_...        (optional — knowledge tools work without it;
 *                               live API tools activate when set; skips hosted OAuth)
 *   ADN_API_BASE_URL=...       (optional, defaults to https://api.audiodelivery.net)
 *   ADN_MCP_LIVE_DOCS=1        (optional, refresh docs from the public site)
 *   ADN_MCP_TIMEOUT_MS=30000   (optional, per-request timeout)
 *
 * Run as a stdio MCP server:
 *   npx @audiodn/mcp
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { normalizeApiKey } from './api-key.js';
import { AdnClient } from './client.js';
import { loadDocStore } from './docs/load-node.js';
import { buildServer } from './server.js';
import { getVersion } from './version.js';

async function main() {
  const apiKey = normalizeApiKey(process.env.ADN_API_KEY);
  const client = apiKey
    ? new AdnClient({
        apiKey,
        baseUrl: process.env.ADN_API_BASE_URL,
        timeoutMs: parseTimeout(process.env.ADN_MCP_TIMEOUT_MS),
      })
    : undefined;

  if (!client) {
    console.error(
      'ADN_API_KEY is not set. Starting with knowledge/doc tools only. Prefer https://mcp.audiodelivery.net/mcp for OAuth account login and onboarding (hosted MCP does not use pasted API keys).',
    );
  }

  const store = loadDocStore();
  await store.maybeRefreshLive();

  const server = buildServer({
    client,
    store,
    version: getVersion(),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No stdout messages; the stdio transport owns stdout.
}

function parseTimeout(value?: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

main().catch((err) => {
  console.error('audiodn-mcp failed to start:', err);
  process.exit(1);
});
