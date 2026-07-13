import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AdnClient } from './client.js';
import { DocStore, GUIDE_TOPICS } from './docs/store.js';
import { zodToJsonSchema } from './schema.js';
import { createApiTools } from './tools/api-tools.js';
import { createKnowledgeTools } from './tools/knowledge-tools.js';
import type { ToolDef } from './tools/types.js';

export interface BuildServerOptions {
  client: AdnClient;
  store: DocStore;
  version: string;
  allowDelete: boolean;
}

export function buildServer(opts: BuildServerOptions): Server {
  const { client, store, version, allowDelete } = opts;

  const allTools: ToolDef[] = [
    ...createApiTools(client),
    ...createKnowledgeTools(store),
  ];

  // Hide delete tools entirely unless explicitly enabled, so the model never
  // sees a destructive capability it is not allowed to use.
  const visibleTools = allTools.filter(
    (t) => t.gated !== 'delete' || allowDelete,
  );

  const server = new Server(
    { name: 'audiodn-mcp', version },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = allTools.find((t) => t.name === req.params.name);
    if (!tool) {
      return errorResult(`Unknown tool: ${req.params.name}`);
    }
    if (tool.gated === 'delete' && !allowDelete) {
      return errorResult(
        `${tool.name} is disabled. Restart the AudioDN MCP server with ADN_MCP_ALLOW_DELETE=1 to enable destructive delete tools.`,
      );
    }
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid arguments for ${tool.name}: ${parsed.error.message}`,
      );
    }
    try {
      const result = await tool.handler(parsed.data as any);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      const suffix = err?.apiRequestId
        ? ` (api_request_id=${err.apiRequestId})`
        : '';
      const status = typeof err?.status === 'number' ? ` [status ${err.status}]` : '';
      return errorResult(
        `${tool.name} failed${status}: ${err?.message ?? String(err)}${suffix}`,
      );
    }
  });

  registerResources(server, store);

  return server;
}

function registerResources(server: Server, store: DocStore) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'audiodn://openapi.json',
        name: 'AudioDN OpenAPI specification',
        mimeType: 'application/json',
      },
      {
        uri: 'audiodn://llms-full.txt',
        name: 'AudioDN llms-full.txt (full docs summary)',
        mimeType: 'text/plain',
      },
      ...GUIDE_TOPICS.map((topic) => ({
        uri: `audiodn://guide/${topic}`,
        name: `AudioDN guide: ${topic}`,
        mimeType: 'text/markdown',
      })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (uri === 'audiodn://openapi.json') {
      return {
        contents: [
          { uri, mimeType: 'application/json', text: store.openapiJson() },
        ],
      };
    }
    if (uri === 'audiodn://llms-full.txt') {
      return {
        contents: [
          { uri, mimeType: 'text/plain', text: store.llmsFullText() },
        ],
      };
    }
    const guideMatch = uri.match(/^audiodn:\/\/guide\/(.+)$/);
    if (guideMatch) {
      const content = store.getGuide(guideMatch[1]);
      if (content) {
        return {
          contents: [{ uri, mimeType: 'text/markdown', text: content }],
        };
      }
    }
    throw new Error(`Unknown resource: ${uri}`);
  });
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}
