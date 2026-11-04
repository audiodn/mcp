import type { AdnClient } from '../client.js';
import { needsInput, structuredResult, type StructuredToolResult } from './structured.js';

export type FindType = 'collection' | 'creator' | 'track';

export interface FindArgs {
  type: FindType;
  name: string;
  collection_id?: string;
}

function labelFor(type: FindType, row: any): string {
  if (type === 'collection') return row.title || '';
  if (type === 'creator') return row.organization_index || '';
  return row.player_title || row.file_name || row.organization_index || '';
}

export async function findResource(
  client: AdnClient,
  args: FindArgs,
): Promise<StructuredToolResult> {
  const name = (args.name || '').trim();
  if (!name) {
    return needsInput('NAME_REQUIRED', 'name is required');
  }
  if (args.type === 'track' && !args.collection_id) {
    return needsInput(
      'COLLECTION_REQUIRED',
      'collection_id is required when finding a track by name',
    );
  }

  let exact: any[] = [];
  let partial: any[] = [];
  let has_more = false;

  if (args.type === 'collection') {
    const res: any = await client.listCollections({ q: name, limit: 20 });
    exact = res.exact || [];
    partial = res.partial || [];
    has_more = Boolean(res.has_more);
  } else if (args.type === 'creator') {
    const res: any = await client.listCreators({ q: name, limit: 20 });
    exact = res.exact || [];
    partial = res.partial || [];
    has_more = Boolean(res.has_more);
  } else {
    const res: any = await client.listTracks(args.collection_id!, {
      q: name,
      limit: 20,
    });
    exact = res.exact || [];
    partial = res.partial || [];
    has_more = Boolean(res.has_more);
  }

  if (exact.length === 1 && partial.length === 0) {
    const row = exact[0];
    return structuredResult({
      status: 'success',
      code: 'EXACT_MATCH',
      message: `Found exact ${args.type} match`,
      match: 'exact',
      resource: row,
      resource_ids: {
        [`${args.type}_id`]: row.id,
        ...(args.type === 'track' ? { collection_id: row.collection_id } : {}),
      },
      label: labelFor(args.type, row),
      has_more,
    });
  }

  if (exact.length > 1) {
    return needsInput(
      args.type === 'collection'
        ? 'COLLECTION_AMBIGUOUS'
        : 'RESOURCE_AMBIGUOUS',
      `Multiple ${args.type}s match "${name}" exactly; choose one id`,
      {
        candidates: exact.map((r) => ({
          id: r.id,
          label: labelFor(args.type, r),
          ...r,
        })),
        has_more,
      },
    );
  }

  if (exact.length === 0 && partial.length === 0) {
    return needsInput(
      args.type === 'collection'
        ? 'COLLECTION_NOT_FOUND'
        : 'RESOURCE_NOT_FOUND',
      `No ${args.type} matched "${name}"`,
      { candidates: [], has_more },
    );
  }

  // Exact empty, partial present — suggestions only, never auto-pick.
  return needsInput(
    args.type === 'collection' ? 'COLLECTION_AMBIGUOUS' : 'RESOURCE_AMBIGUOUS',
    `No exact ${args.type} match for "${name}"; ${partial.length} partial match(es)`,
    {
      match: 'partial',
      candidates: partial.map((r) => ({
        id: r.id,
        label: labelFor(args.type, r),
        ...r,
      })),
      has_more,
    },
  );
}
