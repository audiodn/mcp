import { describe, expect, it } from 'vitest';
import { runToolHandler, toolTextResult } from '../src/tools/run.js';
import type { ToolDef } from '../src/tools/types.js';
import { z } from 'zod';

describe('structured tool results', () => {
  it('attaches structuredContent when the handler returns a status object', () => {
    const result = toolTextResult({
      status: 'pending',
      code: 'PROCESSING_TIMEOUT',
      retryable: true,
    });
    expect(result.structuredContent?.status).toBe('pending');
    expect(result.content[0].text).toContain('PROCESSING_TIMEOUT');
  });

  it('maps API 401 into needs_authorization structured errors', async () => {
    const tool: ToolDef = {
      name: 'adn_demo',
      description: 'demo',
      inputSchema: z.object({}),
      handler: async () => {
        const err: any = new Error('denied');
        err.status = 401;
        err.apiRequestId = 'req-1';
        throw err;
      },
    };
    const result = await runToolHandler(tool, {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.status).toBe('needs_authorization');
    expect(result.structuredContent?.code).toBe('PERMISSION_DENIED');
    expect(result.structuredContent?.api_request_id).toBe('req-1');
  });

  it('maps network timeouts to OPERATION_OUTCOME_UNKNOWN', async () => {
    const tool: ToolDef = {
      name: 'adn_demo',
      description: 'demo',
      inputSchema: z.object({}),
      handler: async () => {
        const err: any = new Error('timed out');
        err.status = 0;
        throw err;
      },
    };
    const result = await runToolHandler(tool, {});
    expect(result.structuredContent?.code).toBe('OPERATION_OUTCOME_UNKNOWN');
    expect(result.structuredContent?.retryable).toBe(true);
  });
});
