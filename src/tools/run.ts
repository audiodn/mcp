import type { ToolDef } from './types.js';

/** Shared MCP result/error formatting used by both the stdio and Worker paths. */

export interface McpTextResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  // Matches the MCP SDK's ServerResult shape so these results are assignable
  // wherever a CallToolResult is expected.
  [key: string]: unknown;
}

export function toolTextResult(result: unknown): McpTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function toolErrorResult(text: string): McpTextResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Human-readable failure message that never echoes the API key. */
export function formatToolError(toolName: string, err: any): string {
  const suffix = err?.apiRequestId ? ` (api_request_id=${err.apiRequestId})` : '';
  const status = typeof err?.status === 'number' ? ` [status ${err.status}]` : '';
  return `${toolName} failed${status}: ${err?.message ?? String(err)}${suffix}`;
}

/** Run a tool handler with already-validated args and format the outcome. */
export async function runToolHandler(
  tool: ToolDef,
  args: unknown,
): Promise<McpTextResult> {
  try {
    const result = await tool.handler(args as any);
    return toolTextResult(result);
  } catch (err) {
    return toolErrorResult(formatToolError(tool.name, err));
  }
}
