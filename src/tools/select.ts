import { AdnClient } from '../client.js';
import type { DocStore } from '../docs/store.js';
import { createApiTools, type ApiToolsOptions } from './api-tools.js';
import { createEmbedTools } from './embed.js';
import { createKnowledgeTools } from './knowledge-tools.js';
import type { ToolDef } from './types.js';

export interface SelectToolsOptions extends ApiToolsOptions {
  /** When set, live API tools are registered (including deletes). */
  client?: AdnClient;
  /**
   * When true without a client, still advertise live API tool schemas so agents
   * can call them and trigger OAuth (hosted HTTP returns 401). Handlers throw.
   */
  advertiseLiveTools?: boolean;
}

/**
 * Shared tool inventory for stdio and the hosted Worker.
 * Knowledge tools always; live API tools (incl. deletes) only with a client
 * (or advertised as auth-gated stubs when advertiseLiveTools is set).
 */
export function selectTools(
  store: DocStore,
  opts: SelectToolsOptions = {},
): ToolDef[] {
  const {
    client,
    advertiseLiveTools,
    connectionId,
    grantApiKeyId,
    onRevokeConnection,
  } = opts;
  const apiOpts: ApiToolsOptions = {
    connectionId,
    grantApiKeyId,
    onRevokeConnection,
  };
  const tools: ToolDef[] = [
    ...createKnowledgeTools(store, { signedIn: Boolean(client) }),
    ...createEmbedTools(),
  ];
  if (client) {
    tools.push(...createApiTools(client, apiOpts));
  } else if (advertiseLiveTools) {
    // Schemas only — hosted worker returns HTTP 401 before these run.
    const stubClient = new AdnClient({
      apiKey: 'adn_oauth_stub_not_for_requests',
    });
    tools.push(
      ...createApiTools(stubClient).map((tool) => ({
        ...tool,
        description: `${tool.description} Requires AudioDN OAuth sign-in (call adn_sign_in or complete account login first).`,
        handler: async () => {
          throw new Error(
            'Authorization required. Complete AudioDN OAuth sign-in, then retry this tool.',
          );
        },
      })),
    );
  }
  return tools;
}

/** All tools (same as selectTools when a client is present). */
export function allTools(store: DocStore, client?: AdnClient): ToolDef[] {
  return selectTools(store, { client });
}
