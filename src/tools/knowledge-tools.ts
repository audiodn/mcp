import { z } from 'zod';
import { DocStore, GUIDE_TOPICS } from '../docs/store.js';
import { LOCAL_READ_ONLY, type ToolDef } from './types.js';

/**
 * Read-only, offline knowledge tools grounded in the bundled canonical
 * snapshots (OpenAPI + llms-full) and curated guides. No network, no API key.
 */
export function createKnowledgeTools(store: DocStore): ToolDef[] {
  return [
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
        'Get a concise, canonical guide for a core AudioDN concept. Topics: authentication, upload, processing, playback, webhooks, variant-types, security, compatibility.',
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
      name: 'adn_list_variant_types',
      description:
        'List the AudioDN variant types (transcode, preview, levels, waveform_video, waveform_image, original, cover) with descriptions and whether each can be created via the REST API. Use this to distinguish variant types from org delivery "index" values (see adn_list_variants).',
      inputSchema: z.object({}),
      annotations: { ...LOCAL_READ_ONLY, title: 'List variant types' },
      handler: () => ({ variantTypes: store.listVariantTypes() }),
    },
  ];
}
