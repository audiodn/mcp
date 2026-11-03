import { describe, expect, it } from 'vitest';
import { loadDocStore } from '../src/docs/load-node.js';
import {
  OMITTED_OPERATIONS,
  OPERATION_TOOL_MAP,
  createApiTools,
} from '../src/tools/api-tools.js';
import { AdnClient } from '../src/client.js';

const store = loadDocStore();

describe('OpenAPI ↔ MCP operation contract', () => {
  it('maps every bundled operationId to a tool or an explicit omission', () => {
    const ops = store.listOperations();
    expect(ops.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const op of ops) {
      if (!(op.operationId in OPERATION_TOOL_MAP)) {
        missing.push(op.operationId);
      }
    }
    expect(missing, `unmapped operationIds: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents a reason for every omitted operation', () => {
    for (const [opId, tool] of Object.entries(OPERATION_TOOL_MAP)) {
      if (tool === null) {
        expect(
          OMITTED_OPERATIONS[opId],
          `missing omission reason for ${opId}`,
        ).toBeTruthy();
      }
    }
  });

  it('registers every non-null mapped tool name', () => {
    const tools = createApiTools(new AdnClient({ apiKey: 'adn_test_key_xxxxxxxx' }));
    const names = new Set(tools.map((t) => t.name));
    for (const [opId, tool] of Object.entries(OPERATION_TOOL_MAP)) {
      if (tool !== null) {
        expect(names.has(tool), `${opId} -> ${tool} not registered`).toBe(true);
      }
    }
  });

  it('does not leave stale map entries for removed operations', () => {
    const liveIds = new Set(store.listOperations().map((o) => o.operationId));
    for (const opId of Object.keys(OPERATION_TOOL_MAP)) {
      expect(liveIds.has(opId), `stale map entry: ${opId}`).toBe(true);
    }
  });
});
