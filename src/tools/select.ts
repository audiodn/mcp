import type { AdnClient } from '../client.js';
import type { DocStore } from '../docs/store.js';
import { createApiTools } from './api-tools.js';
import { createKnowledgeTools } from './knowledge-tools.js';
import type { ToolDef } from './types.js';

export interface SelectToolsOptions {
  /** When set, live API tools are registered (including deletes). */
  client?: AdnClient;
}

/**
 * Shared tool inventory for stdio and the hosted Worker.
 * Knowledge tools always; live API tools (incl. deletes) only with a client.
 */
export function selectTools(
  store: DocStore,
  opts: SelectToolsOptions = {},
): ToolDef[] {
  const tools: ToolDef[] = [...createKnowledgeTools(store)];
  if (opts.client) {
    tools.push(...createApiTools(opts.client));
  }
  return tools;
}

/** All tools (same as selectTools when a client is present). */
export function allTools(store: DocStore, client?: AdnClient): ToolDef[] {
  return selectTools(store, { client });
}
