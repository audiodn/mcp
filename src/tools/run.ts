import type { ToolDef } from './types.js';

/** Shared MCP result/error formatting used by both the stdio and Worker paths. */

export interface McpTextResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  // Matches the MCP SDK's ServerResult shape so these results are assignable
  // wherever a CallToolResult is expected.
  [key: string]: unknown;
}

export function toolTextResult(result: unknown): McpTextResult {
  const text = JSON.stringify(result, null, 2);
  if (result && typeof result === 'object' && 'status' in (result as object)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: result as Record<string, unknown>,
    };
  }
  return { content: [{ type: 'text', text }] };
}

export function toolErrorResult(
  text: string,
  structured?: Record<string, unknown>,
): McpTextResult {
  return {
    isError: true,
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Human-readable failure message that never echoes the API key. */
export function formatToolError(toolName: string, err: any): string {
  const suffix = err?.apiRequestId ? ` (api_request_id=${err.apiRequestId})` : '';
  const status = typeof err?.status === 'number' ? ` [status ${err.status}]` : '';
  return `${toolName} failed${status}: ${err?.message ?? String(err)}${suffix}`;
}

function classifyApiError(err: any): Record<string, unknown> {
  const status = typeof err?.status === 'number' ? err.status : 0;
  let toolStatus = 'terminal_error';
  let code = 'TERMINAL_ERROR';
  let retryable = false;
  if (status === 401 || status === 403) {
    toolStatus = 'needs_authorization';
    code = 'PERMISSION_DENIED';
  } else if (status === 404) {
    code = 'RESOURCE_NOT_FOUND';
  } else if (status === 409) {
    code = 'IDEMPOTENCY_CONFLICT';
  } else if (status === 429 || status >= 500) {
    toolStatus = 'retryable_error';
    code = status === 429 ? 'RATE_LIMITED' : 'RETRYABLE_ERROR';
    retryable = true;
  } else if (status === 0) {
    toolStatus = 'retryable_error';
    code = 'OPERATION_OUTCOME_UNKNOWN';
    retryable = true;
  }
  return {
    status: toolStatus,
    code,
    message: err?.message ?? String(err),
    api_request_id: err?.apiRequestId,
    retryable,
    http_status: status || undefined,
  };
}

/** Run a tool handler with already-validated args and format the outcome. */
export async function runToolHandler(
  tool: ToolDef,
  args: unknown,
): Promise<McpTextResult> {
  try {
    const result = await tool.handler(args as any);
    const formatted = toolTextResult(result);
    if (
      result &&
      typeof result === 'object' &&
      (result as any).status &&
      ['needs_input', 'needs_authorization', 'terminal_error', 'retryable_error'].includes(
        (result as any).status,
      )
    ) {
      // Application-level soft failures stay as tool results the model can read;
      // only transport/API throws become isError.
      return formatted;
    }
    return formatted;
  } catch (err) {
    const structured = classifyApiError(err);
    return toolErrorResult(formatToolError(tool.name, err), structured);
  }
}
