/**
 * Decide whether an unauthenticated /mcp JSON-RPC request needs OAuth.
 *
 * Knowledge tools, initialize, tools/list, resources, and pings are allowed
 * without credentials. Live API tool calls (and explicit sign-in) return 401
 * so the MCP client can start the OAuth account flow.
 */

const KNOWLEDGE_TOOL_NAMES = new Set([
  'adn_about',
  'adn_search_docs',
  'adn_list_operations',
  'adn_get_operation',
  'adn_get_guide',
  'adn_list_output_types',
  'adn_list_variant_types',
  // Offline HTML composer — no API call, no account required.
  'adn_build_player_embed',
]);

/** Tools that are allowed without an account. */
export function isKnowledgeToolName(name: string | undefined): boolean {
  return Boolean(name && KNOWLEDGE_TOOL_NAMES.has(name));
}

/**
 * True when this MCP request must be authenticated (OAuth).
 * Returns false when the body cannot be inspected (allow through to knowledge
 * server / let the MCP stack respond).
 */
export async function mcpRequestRequiresOAuth(
  request: Request,
): Promise<boolean> {
  if (request.method === 'GET' || request.method === 'DELETE') {
    // Streamable HTTP session GETs are protocol traffic, not live tool calls.
    return false;
  }
  if (request.method !== 'POST') return false;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return false;
  }

  const messages = Array.isArray(body) ? body : [body];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const method = (msg as { method?: unknown }).method;
    if (typeof method !== 'string') continue;

    if (method === 'tools/call') {
      const params = (msg as { params?: { name?: unknown } }).params;
      const name = typeof params?.name === 'string' ? params.name : undefined;
      if (!name) return true;
      if (name === 'adn_sign_in') return true;
      if (!isKnowledgeToolName(name)) return true;
    }
  }
  return false;
}
