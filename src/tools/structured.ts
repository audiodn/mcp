/** Application-level structured tool results for agent branching. */

export type ToolStatus =
  | 'success'
  | 'needs_input'
  | 'needs_authorization'
  | 'pending'
  | 'retryable_error'
  | 'terminal_error'
  | 'partial_success';

export interface StructuredToolResult {
  status: ToolStatus;
  code?: string;
  message?: string;
  api_request_id?: string;
  retryable?: boolean;
  retry_after_seconds?: number;
  candidates?: unknown[];
  resource_ids?: Record<string, string | null | undefined>;
  [key: string]: unknown;
}

export function structuredResult(
  fields: StructuredToolResult,
): StructuredToolResult {
  return fields;
}

export function needsInput(
  code: string,
  message: string,
  extra: Partial<StructuredToolResult> = {},
): StructuredToolResult {
  return structuredResult({
    status: 'needs_input',
    code,
    message,
    retryable: false,
    ...extra,
  });
}

export function pendingResult(
  code: string,
  message: string,
  retryAfterSeconds: number,
  extra: Partial<StructuredToolResult> = {},
): StructuredToolResult {
  return structuredResult({
    status: 'pending',
    code,
    message,
    retryable: true,
    retry_after_seconds: retryAfterSeconds,
    ...extra,
  });
}
