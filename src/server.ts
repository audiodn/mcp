import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AdnClient } from './client.js';
import type { DocStore } from './docs/store.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { listResourceDescriptors, readResource } from './resources.js';
import { zodToJsonSchema } from './schema.js';
import { selectTools } from './tools/select.js';
import { runToolHandler, toolErrorResult } from './tools/run.js';

export interface BuildServerOptions {
  /** When omitted, only knowledge tools are registered. */
  client?: AdnClient;
  store: DocStore;
  version: string;
}

export function buildServer(opts: BuildServerOptions): Server {
  const { client, store, version } = opts;

  const visibleTools = selectTools(store, { client });

  const server = new Server(
    { name: 'audiodn-mcp', version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
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
    const tool = visibleTools.find((t) => t.name === req.params.name);
    if (!tool) {
      return toolErrorResult(`Unknown tool: ${req.params.name}`);
    }
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return toolErrorResult(
        `Invalid arguments for ${tool.name}: ${parsed.error.message}`,
      );
    }
    return runToolHandler(tool, parsed.data);
  });

  registerResources(server, store);

  return server;
}

function registerResources(server: Server, store: DocStore) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResourceDescriptors(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const content = readResource(store, uri);
    if (!content) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return {
      contents: [
        { uri: content.uri, mimeType: content.mimeType, text: content.text },
      ],
    };
  });
}
