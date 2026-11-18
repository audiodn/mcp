import { z } from 'zod';
import { DocStore, GUIDE_TOPICS } from '../docs/store.js';
import { LOCAL_READ_ONLY, type ToolDef } from './types.js';

export interface KnowledgeToolsOptions {
  /** When true, adn_sign_in reports the session is already authorized. */
  signedIn?: boolean;
}

/**
 * Read-only, offline knowledge tools grounded in the bundled canonical
 * snapshots (OpenAPI + llms-full) and curated guides. No network, no API key.
 */
export function createKnowledgeTools(
  store: DocStore,
  opts: KnowledgeToolsOptions = {},
): ToolDef[] {
  const signedIn = Boolean(opts.signedIn);
  return [
    {
      name: 'adn_sign_in',
      description: signedIn
        ? 'Confirm AudioDN account login status. Already signed in — proceed with live API tools (upload, collections, play sessions).'
        : 'Start AudioDN account login (OAuth). Call this when the user wants to upload tracks, manage collections, embed a player, or otherwise use live API tools and is not signed in yet. On the hosted MCP URL this triggers the client OAuth flow (sign up or log in, create org, pick output presets, default collection, optional trial). After sign-in, retry the live tool.',
      inputSchema: z.object({
        reason: z
          .string()
          .optional()
          .describe(
            'Short reason shown in logs (e.g. "upload a track", "embed player").',
          ),
      }),
      annotations: { ...LOCAL_READ_ONLY, title: 'Sign in to AudioDN' },
      handler: (args: any) =>
        signedIn
          ? {
              status: 'success',
              code: 'ALREADY_AUTHENTICATED',
              reason: args.reason || null,
              message:
                'Already signed in to AudioDN. Proceed with live API tools such as adn_create_track, adn_create_collection, or adn_create_play_session.',
            }
          : {
              status: 'needs_auth',
              code: 'OAUTH_REQUIRED',
              reason: args.reason || null,
              message:
                'AudioDN account login is required for live API tools. On the hosted MCP endpoint (https://mcp.audiodelivery.net/mcp), complete OAuth in your client (sign up or log in). That flow creates your organization, default collection, and recommended output presets. Then retry the upload or player action.',
              hosted_mcp_url: 'https://mcp.audiodelivery.net/mcp',
              account_url: 'https://account.audiodeliverynetwork.com',
            },
    },
    {
      name: 'adn_about',
      description:
        'Report the MCP server version, the bundled OpenAPI version, the docs source (bundled snapshot vs live), and the canonical API base URL. Use this to confirm how fresh the grounded documentation is.',
      inputSchema: z.object({}),
      annotations: { ...LOCAL_READ_ONLY, title: 'About this server' },
      handler: () => store.about(),
    },
    {
      name: 'adn_search_docs',
      description:
        'Search the bundled AudioDN documentation (llms-full.txt, OpenAPI operation summaries, and guides) for a keyword or phrase. Returns ranked snippets. Use this before writing integration code to ground answers in canonical docs.',
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { ...LOCAL_READ_ONLY, title: 'Search docs' },
      handler: (args: any) => ({
        query: args.query,
        results: store.searchDocs(args.query, args.limit ?? 5),
      }),
    },
    {
      name: 'adn_list_operations',
      description:
        'List every AudioDN REST API operation from the bundled OpenAPI spec (operationId, method, path, summary). Use this to discover the exact, canonical endpoints instead of guessing.',
      inputSchema: z.object({}),
      annotations: { ...LOCAL_READ_ONLY, title: 'List API operations' },
      handler: () => ({ operations: store.listOperations() }),
    },
    {
      name: 'adn_get_operation',
      description:
        'Get the full OpenAPI definition for a single operation by operationId (method, path, parameters, request body, responses). Use adn_list_operations to find operationIds.',
      inputSchema: z.object({ operationId: z.string().min(1) }),
      annotations: { ...LOCAL_READ_ONLY, title: 'Get API operation' },
      handler: (args: any) => {
        const op = store.getOperation(args.operationId);
        if (!op) {
          throw new Error(
            `Unknown operationId "${args.operationId}". Call adn_list_operations to see valid ids.`,
          );
        }
        return op;
      },
    },
    {
      name: 'adn_get_guide',
      description:
        'Get a concise, canonical guide for a core AudioDN concept. Topics: authentication, upload, processing, playback, webhooks, output-types (alias: variant-types), security, compatibility, workflows, web-components, native-playback.',
      inputSchema: z.object({ topic: z.enum(GUIDE_TOPICS) }),
      annotations: { ...LOCAL_READ_ONLY, title: 'Get guide' },
      handler: (args: any) => {
        const content = store.getGuide(args.topic);
        if (!content) {
          throw new Error(
            `Unknown guide topic "${args.topic}". Valid topics: ${GUIDE_TOPICS.join(', ')}.`,
          );
        }
        return { topic: args.topic, content };
      },
    },
    {
      name: 'adn_list_output_types',
      description:
        'List AudioDN output types (transcode, preview, levels, waveform_video, waveform_image, original, cover) with descriptions and whether each can be created via the REST API. Use this to distinguish output types from org delivery "index" values (see adn_list_output_presets).',
      inputSchema: z.object({}),
      annotations: { ...LOCAL_READ_ONLY, title: 'List output types' },
      handler: listOutputTypes,
    },
    {
      name: 'adn_list_variant_types',
      description: 'Legacy name for adn_list_output_types',
      inputSchema: z.object({}),
      annotations: { ...LOCAL_READ_ONLY, title: 'List variant types (legacy)' },
      handler: listOutputTypes,
    },
  ];

  function listOutputTypes() {
    const types = store.listVariantTypes();
    return { outputTypes: types, variantTypes: types };
  }
}
