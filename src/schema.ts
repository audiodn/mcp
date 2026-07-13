import { z } from 'zod';

/**
 * Minimal Zod -> JSON Schema conversion sufficient for MCP tool descriptors.
 * Avoids pulling in zod-to-json-schema for a thin shim. Emits `description`
 * (from `.describe()`), enums, defaults, and common string/number constraints.
 */
export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, any> {
  const out = convert(schema);
  const description = (schema as any)?._def?.description;
  if (description && typeof out === 'object' && !('description' in out)) {
    out.description = description;
  }
  return out;
}

function convert(schema: z.ZodType<any>): Record<string, any> {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const v = value as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(v);
      if (!isOptionalLike(v)) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema((schema as any)._def.innerType);
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodToJsonSchema((schema as any)._def.innerType);
    const def = (schema as any)._def.defaultValue;
    return { ...inner, default: typeof def === 'function' ? def() : def };
  }
  if (schema instanceof z.ZodString) {
    const desc: Record<string, any> = { type: 'string' };
    const checks = (schema as any)._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === 'uuid') desc.format = 'uuid';
      if (c.kind === 'min' && typeof c.value === 'number') desc.minLength = c.value;
      if (c.kind === 'max' && typeof c.value === 'number') desc.maxLength = c.value;
      if (c.kind === 'regex') desc.pattern = c.regex.source;
    }
    return desc;
  }
  if (schema instanceof z.ZodNumber) {
    const desc: Record<string, any> = { type: 'number' };
    const checks = (schema as any)._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === 'int') desc.type = 'integer';
      if (c.kind === 'min' && typeof c.value === 'number') desc.minimum = c.value;
      if (c.kind === 'max' && typeof c.value === 'number') desc.maximum = c.value;
    }
    return desc;
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: (schema as any)._def.values };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema((schema as any)._def.type),
    };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return {};
  }
  return {};
}

function isOptionalLike(v: z.ZodTypeAny): boolean {
  return v instanceof z.ZodOptional || v instanceof z.ZodDefault;
}
