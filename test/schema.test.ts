import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src/schema.js';

describe('zodToJsonSchema', () => {
  it('marks non-optional fields as required and optional ones as not', () => {
    const schema = z.object({
      id: z.string().uuid(),
      limit: z.number().int().min(1).max(200).optional(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.required).toEqual(['id']);
    expect(json.additionalProperties).toBe(false);
    expect(json.properties.id).toMatchObject({ type: 'string', format: 'uuid' });
    expect(json.properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 200 });
  });

  it('emits enums and descriptions', () => {
    const schema = z.object({
      scope: z.enum(['collection', 'track']).describe('play session scope'),
    });
    const json = zodToJsonSchema(schema);
    expect(json.properties.scope.enum).toEqual(['collection', 'track']);
    expect(json.properties.scope.description).toBe('play session scope');
  });

  it('handles arrays, records, and booleans', () => {
    const schema = z.object({
      variants: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional(),
      confirm: z.boolean().optional(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.properties.variants).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(json.properties.metadata).toMatchObject({ type: 'object', additionalProperties: true });
    expect(json.properties.confirm).toMatchObject({ type: 'boolean' });
    expect(json.required).toBeUndefined();
  });
});
